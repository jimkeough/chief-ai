// Chief's on-demand dev environment (SANDBOX-PLAN.md, Phase 1 — the seam).
//
// Chief's production runtime is a read-only, ephemeral Vercel Function — it can't
// be its own workshop. This module is the seam that lets Chief create one *beside*
// the running app: an ephemeral Vercel Sandbox microVM it can clone the repo into
// and run commands in. Phase 1 is deliberately small — a provisioning spike
// (clone the repo, run a few fast commands, tear down) that proves the plumbing
// and surfaces real cost/latency BEFORE any coding agent is wired in (Phase 2
// launches Claude Code headless in here; see the plan).
//
// SCOPE / SAFETY (matches SANDBOX-PLAN.md):
//   - Sovereign edition only, and gated behind the `devmode.sandbox_enabled`
//     setting (default off). Callers must check `isSandboxEnabled()`.
//   - Nothing here writes to production or to the user's data. The VM is a
//     throwaway clone; the only path to production stays "open a PR, you merge".
//   - Every run is bounded (vcpus + wall-clock ceiling) and ALWAYS torn down,
//     so a stuck job can't rack up cost.
//
// NOTE: this cannot be exercised from a plain dev container — the Vercel Sandbox
// SDK needs the Vercel runtime + an OIDC token. Verify on a preview deploy.

import { Sandbox } from "@vercel/sandbox";
import { getSetting } from "@/lib/settings";
import { getMcpServers } from "@/lib/mcp";
import type { DeployTarget } from "@/lib/deploy-target";

// A dev-loop sandbox is interactive and single-user, not a fan-out — keep it
// small and short-lived. These are hard ceilings, not defaults to grow.
const SANDBOX_VCPUS = 4;
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SANDBOX_RUNTIME = "node24";
// Bound each captured stream so a chatty command can't flood the response / the
// model context downstream.
const MAX_OUTPUT_CHARS = 4000;

export type SandboxStep = {
  /** Human label for the step, shown in the result. */
  label: string;
  cmd: string;
  args: string[];
};

export type SandboxStepResult = {
  label: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SandboxRunResult = {
  /** The sandbox's unique name (its identifier), or null if it never started. */
  sandboxName: string | null;
  ok: boolean;
  steps: SandboxStepResult[];
  /** Set when provisioning itself failed (before/around the steps). */
  error?: string;
};

// A fast default spike that fits inside a serverless function's max-duration:
// prove the VM booted, the clone landed, and we can see the repo's HEAD. The
// heavier `npm ci` + `npm run typecheck` check belongs in Phase 2, where the run
// is backgrounded rather than awaited inside one request.
export const DEFAULT_SPIKE_STEPS: SandboxStep[] = [
  { label: "node version", cmd: "node", args: ["--version"] },
  { label: "cloned HEAD sha", cmd: "git", args: ["rev-parse", "HEAD"] },
  { label: "cloned HEAD subject", cmd: "git", args: ["log", "-1", "--pretty=%s"] },
];

function clip(s: string): string {
  const t = s.trimEnd();
  return t.length > MAX_OUTPUT_CHARS
    ? `${t.slice(0, MAX_OUTPUT_CHARS)}\n…[clipped]`
    : t;
}

/** The Sandbox SDK authenticates with the deployment's Vercel OIDC token.
 *  The subtlety (same as lib/ai.ts): on Vercel the token is an env var only at
 *  BUILD time — at RUNTIME it arrives via the request context and `process.env`
 *  is empty, so we must fall back to `getVercelOidcToken()`. Checking only the
 *  env var wrongly reported "no token" at runtime and blocked the sandbox. */
export async function isSandboxConfigured(): Promise<boolean> {
  if (process.env.VERCEL_OIDC_TOKEN?.trim()) return true;
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    return Boolean((await getVercelOidcToken())?.trim());
  } catch {
    // Not on Vercel, Secure Backend Access off, or no request context.
    return false;
  }
}

/** The user-facing kill switch. Sovereign-only, default off (see the setting
 *  def). Callers MUST gate on this before creating a sandbox. */
export async function isSandboxEnabled(): Promise<boolean> {
  const raw = await getSetting("devmode.sandbox_enabled").catch(() => "off");
  return raw.trim().toLowerCase() === "on";
}

/** Reuse the token from an already-connected GitHub MCP connection (the one the
 *  "Update this app" loop uses), so the sandbox needs no separate PAT. Returns
 *  null if GitHub isn't connected with a bearer token. */
export async function getConnectedGithubToken(): Promise<string | null> {
  try {
    const servers = await getMcpServers();
    const github = servers.find(
      (s) => (s.app ?? s.name).toLowerCase() === "github",
    );
    return github?.authorization_token?.trim() || null;
  } catch {
    return null;
  }
}

/** Phase 1 provisioning spike: spin up a fresh sandbox, clone the target repo
 *  (shallow, at its default branch), run `steps` in order capturing each one's
 *  exit code + output, and ALWAYS tear the sandbox down. Stops at the first
 *  non-zero exit. This is NOT the agent loop — it exists to prove provisioning
 *  works and to measure real cost/latency.
 *
 *  `token` (optional) is a GitHub credential for cloning a PRIVATE repo over
 *  HTTPS; omit for a public repo. It is used only to construct the clone auth
 *  and never returned. */
export async function provisionAndCheck(opts: {
  target: DeployTarget;
  token?: string | null;
  steps?: SandboxStep[];
}): Promise<SandboxRunResult> {
  const { target } = opts;
  if (!target.slug) {
    return {
      sandboxName: null,
      ok: false,
      steps: [],
      error:
        "No target repo resolved. Set Config → Developer → Repo (owner/repo), or deploy on Vercel where it's auto-detected.",
    };
  }

  const steps = opts.steps?.length ? opts.steps : DEFAULT_SPIKE_STEPS;
  const url = `https://github.com/${target.slug}.git`;
  const token = opts.token?.trim();

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create({
      source: token
        ? {
            type: "git",
            url,
            username: "x-access-token",
            password: token,
            revision: target.defaultBranch,
            depth: 1,
          }
        : { type: "git", url, revision: target.defaultBranch, depth: 1 },
      resources: { vcpus: SANDBOX_VCPUS },
      timeout: SANDBOX_TIMEOUT_MS,
      runtime: SANDBOX_RUNTIME,
    });

    const results: SandboxStepResult[] = [];
    let ok = true;
    for (const step of steps) {
      const finished = await sandbox.runCommand({
        cmd: step.cmd,
        args: step.args,
      });
      const [stdout, stderr] = await Promise.all([
        finished.stdout(),
        finished.stderr(),
      ]);
      results.push({
        label: step.label,
        command: `${step.cmd} ${step.args.join(" ")}`.trim(),
        exitCode: finished.exitCode,
        stdout: clip(stdout),
        stderr: clip(stderr),
      });
      if (finished.exitCode !== 0) {
        ok = false;
        break; // don't keep running steps once one has failed
      }
    }

    return { sandboxName: sandbox.name, ok, steps: results };
  } catch (error) {
    return {
      sandboxName: sandbox?.name ?? null,
      ok: false,
      steps: [],
      error: error instanceof Error ? error.message : "Sandbox provisioning failed.",
    };
  } finally {
    // Always stop — a persisted sandbox keeps billing. Best-effort.
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        /* the run already produced its result; teardown is best-effort */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — launch Claude Code (headless) inside the sandbox as the engineer.
//
// This is the orchestrator flow from SANDBOX-PLAN.md: Chief hands a task to
// Claude Code running in a throwaway VM; Claude Code reads/edits the checkout;
// we run the git plumbing and open ONE PR. Because the VM is ephemeral and
// isolated, the agent's edits/commands are NOT production writes and run under
// `--dangerously-skip-permissions` (the isolation is what makes that safe — the
// same reasoning as the plan's throwaway-VM allowlist). The ONLY thing that
// reaches your repo is the pull request, and the ONLY path to production stays
// your merge.
// ---------------------------------------------------------------------------

const AGENT_VCPUS = 4;
// The agent run is much longer than the Phase-1 spike; give the VM room. NOTE:
// the calling serverless function has its own (shorter) max-duration ceiling —
// a full run can exceed it, which is why the route documents that long runs
// must be backgrounded. This timeout only bounds the VM itself.
const AGENT_SANDBOX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const AGENT_MAX_TURNS = 30;

export type AgentRunResult = {
  ok: boolean;
  /** The branch Claude Code's work was pushed to, if we got that far. */
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  /** Claude Code's captured (clipped) output. */
  agentOutput: string;
  /** Per-command trace, for debugging a failed run. */
  steps: SandboxStepResult[];
  error?: string;
};

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "change"
  );
}

/** Open a PR via the GitHub REST API (app-side, with the same token used to
 *  push). Kept out of the VM so PR text stays in our control. */
async function openPullRequest(opts: {
  slug: string;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number } | { error: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${opts.slug}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body,
        draft: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `GitHub PR create failed (${res.status}): ${text.slice(0, 300)}` };
    }
    const json = (await res.json()) as { html_url?: string; number?: number };
    if (!json.html_url || typeof json.number !== "number") {
      return { error: "GitHub PR create returned an unexpected response." };
    }
    return { url: json.html_url, number: json.number };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "GitHub PR create failed." };
  }
}

/** Run a coding task end to end in a fresh sandbox: clone → install Claude Code
 *  → let it edit on a new branch → commit + push → open a draft PR. Always tears
 *  the VM down. Returns the PR link (or a precise failure). Both credentials are
 *  used only inside the VM / for the PR call and are never returned.
 *
 *  `anthropicKey` authenticates Claude Code; `githubToken` clones, pushes, and
 *  opens the PR (needs Contents + Pull Requests write on the repo). */
export async function runCodingAgent(opts: {
  target: DeployTarget;
  task: string;
  githubToken: string;
  anthropicKey: string;
  maxTurns?: number;
  branchPrefix?: string;
}): Promise<AgentRunResult> {
  const { target } = opts;
  const task = opts.task?.trim();
  const empty: AgentRunResult = {
    ok: false,
    branch: null,
    prUrl: null,
    prNumber: null,
    agentOutput: "",
    steps: [],
  };
  if (!target.slug) {
    return { ...empty, error: "No target repo resolved." };
  }
  if (!task) {
    return { ...empty, error: "No task provided." };
  }
  if (!opts.githubToken?.trim()) {
    return { ...empty, error: "A GitHub token is required to clone, push, and open the PR." };
  }
  if (!opts.anthropicKey?.trim()) {
    return { ...empty, error: "An Anthropic API key is required to run Claude Code." };
  }

  const slug = target.slug;
  const token = opts.githubToken.trim();
  const base = target.defaultBranch;
  const branch = `chief/${slugify(task)}-${Date.now().toString(36)}`;
  const authUrl = `https://x-access-token:${token}@github.com/${slug}.git`;
  const maxTurns = opts.maxTurns ?? AGENT_MAX_TURNS;

  const steps: SandboxStepResult[] = [];
  let sandbox: Sandbox | undefined;

  // Local helper: run a command, record the step, and return the finished cmd.
  const run = async (
    label: string,
    cmd: string,
    args: string[],
    runOpts?: { env?: Record<string, string>; sudo?: boolean },
  ) => {
    const finished = await sandbox!.runCommand({ cmd, args, ...runOpts });
    const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()]);
    steps.push({
      label,
      command: `${cmd} ${args.join(" ")}`.trim(),
      exitCode: finished.exitCode,
      stdout: clip(stdout),
      stderr: clip(stderr),
    });
    return finished;
  };

  try {
    sandbox = await Sandbox.create({
      source: {
        type: "git",
        url: `https://github.com/${slug}.git`,
        username: "x-access-token",
        password: token,
        revision: base,
        depth: 1,
      },
      resources: { vcpus: AGENT_VCPUS },
      timeout: AGENT_SANDBOX_TIMEOUT_MS,
      runtime: SANDBOX_RUNTIME,
    });

    // Install the Claude Code CLI (global, needs root).
    const install = await run(
      "install claude code",
      "npm",
      ["install", "-g", "@anthropic-ai/claude-code"],
      { sudo: true },
    );
    if (install.exitCode !== 0) {
      return { ...empty, branch: null, steps, error: "Failed to install Claude Code in the sandbox." };
    }

    // Git identity + push auth + a fresh working branch.
    await run("git identity (email)", "git", ["config", "user.email", "chief@users.noreply.github.com"]);
    await run("git identity (name)", "git", ["config", "user.name", "Chief (sandbox)"]);
    await run("set push remote", "git", ["remote", "set-url", "origin", authUrl]);
    const checkout = await run("create branch", "git", ["checkout", "-b", branch]);
    if (checkout.exitCode !== 0) {
      return { ...empty, branch: null, steps, error: "Failed to create a working branch." };
    }

    // Hand the task to Claude Code. It runs headless in the isolated VM; edits
    // auto-apply (skip-permissions is safe because the VM is a throwaway clone),
    // bounded by a turn cap. We capture its final JSON result.
    const agent = await run(
      "claude code",
      "claude",
      [
        "-p",
        task,
        "--dangerously-skip-permissions",
        "--max-turns",
        String(maxTurns),
        "--output-format",
        "json",
      ],
      { env: { ANTHROPIC_API_KEY: opts.anthropicKey.trim() } },
    );
    const agentOutput = steps[steps.length - 1]?.stdout ?? "";
    if (agent.exitCode !== 0) {
      return { ...empty, branch, agentOutput, steps, error: "Claude Code exited with an error." };
    }

    // Did it actually change anything?
    const status = await run("check for changes", "git", ["status", "--porcelain"]);
    if (!(await status.stdout()).trim()) {
      return {
        ...empty,
        branch,
        agentOutput,
        steps,
        error: "Claude Code made no file changes, so there is nothing to open a PR for.",
      };
    }

    // Commit + push the branch.
    await run("stage changes", "git", ["add", "-A"]);
    const title = task.split("\n")[0].slice(0, 72);
    const commit = await run("commit", "git", [
      "commit",
      "-m",
      title,
      "-m",
      "Authored by Claude Code in a Vercel Sandbox, on request from Chief.",
    ]);
    if (commit.exitCode !== 0) {
      return { ...empty, branch, agentOutput, steps, error: "Failed to commit the changes." };
    }
    const push = await run("push", "git", ["push", "origin", branch]);
    if (push.exitCode !== 0) {
      return { ...empty, branch, agentOutput, steps, error: "Failed to push the branch." };
    }

    // Open the PR (draft) from the app side, using the same token.
    const pr = await openPullRequest({
      slug,
      token,
      head: branch,
      base,
      title,
      body: [
        `Requested via Chief's sandbox dev loop:`,
        "",
        "> " + task.replace(/\n/g, "\n> "),
        "",
        "Authored by Claude Code in an ephemeral Vercel Sandbox. Review and merge — nothing deploys until you do.",
      ].join("\n"),
    });
    if ("error" in pr) {
      return { ...empty, branch, agentOutput, steps, error: `Pushed ${branch}, but ${pr.error}` };
    }

    return { ok: true, branch, prUrl: pr.url, prNumber: pr.number, agentOutput, steps };
  } catch (error) {
    return {
      ...empty,
      branch,
      steps,
      error: error instanceof Error ? error.message : "Coding-agent run failed.",
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        /* best-effort teardown */
      }
    }
  }
}
