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

/** The Sandbox SDK authenticates with the deployment's Vercel OIDC token
 *  (injected on Vercel; `vercel env pull` locally). Without it, provisioning
 *  can't run — check this before offering the capability. */
export function isSandboxConfigured(): boolean {
  return Boolean(process.env.VERCEL_OIDC_TOKEN?.trim());
}

/** The user-facing kill switch. Sovereign-only, default off (see the setting
 *  def). Callers MUST gate on this before creating a sandbox. */
export async function isSandboxEnabled(): Promise<boolean> {
  const raw = await getSetting("devmode.sandbox_enabled").catch(() => "off");
  return raw.trim().toLowerCase() === "on";
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
