// /api/dev/sandbox-agent — the orchestrator flow (SANDBOX-PLAN.md), backgrounded.
// Owner-authed and gated behind `devmode.sandbox_enabled`.
//
// POST starts a job: it records a `sandbox_jobs` row, kicks off the real work
// AFTER responding (spin up an ephemeral Vercel Sandbox → install Claude Code →
// let it edit the checkout on a fresh branch → commit + push → open a DRAFT PR →
// tear the VM down), and returns a jobId immediately. GET reports a job's status
// so the UI can poll for the PR link instead of holding one long request open.
//
// This is the "Chief orchestrates, Claude Code engineers, you merge" loop. The
// VM is a throwaway clone: the agent's edits are not production writes, and the
// only thing that reaches the repo is the PR you review. Nothing deploys until
// you merge.
//
// It can't be exercised from a dev container / CI (the Sandbox SDK needs the
// Vercel runtime + OIDC token) — verify on a preview deploy.
//
// DURATION: the background work still runs within the function's max-duration
// ceiling (`after`), so very long runs need Fluid compute / a higher limit — but
// the CLIENT no longer waits, so a run can outlive the page and the PR simply
// appears on GitHub when it finishes.
//
// POST body: {
//   "task": "<what to change>",           // required
//   "token": "<github token>",            // optional; else connected GitHub / env
//   "anthropicKey": "<key>",              // optional override; else the app's
//                                         //   AI provider (gateway OIDC / key)
//   "maxTurns": 30                        // optional
// }
// GET: ?jobId=<id> for one job, or no param for the caller's latest job.

import { after } from "next/server";
import { getAuthed } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { resolveSandboxAgentEnv } from "@/lib/ai";
import { getDeployTarget } from "@/lib/deploy-target";
import {
  getConnectedGithubToken,
  isSandboxConfigured,
  isSandboxEnabled,
  resolveVercelOidcToken,
  runCodingAgent,
} from "@/lib/sandbox";
import {
  completeSandboxJob,
  createSandboxJob,
  getSandboxJob,
} from "@/lib/sandbox-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The background work (via `after`) runs up to this ceiling. 300s is the max
// Vercel allows on the Hobby plan — a higher value is REJECTED at build time,
// not silently capped. Long runs need Fluid/Pro to raise this. The client
// doesn't wait on it regardless — it polls GET, so a run can outlive the page.
export const maxDuration = 300;

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return new Response("Not signed in.", { status: 401 });

  if (!(await isSandboxEnabled())) {
    return Response.json(
      {
        error:
          "The sandbox dev environment is off. Turn on Config → Developer → \"Sandbox dev environment\" first.",
      },
      { status: 403 },
    );
  }

  if (!(await isSandboxConfigured())) {
    return Response.json(
      {
        error:
          "No Vercel OIDC token is available, so the sandbox can't authenticate. This runs on a Vercel deployment, or locally after `vercel env pull`.",
      },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    task?: string;
    token?: string;
    anthropicKey?: string;
    maxTurns?: number;
  };

  const task = body.task?.trim();
  if (!task) {
    return Response.json({ error: "A `task` is required." }, { status: 400 });
  }

  const githubToken =
    body.token?.trim() ||
    (await getSetting("devmode.github_token").catch(() => "")).trim() ||
    (await getConnectedGithubToken()) ||
    process.env.GITHUB_TOKEN?.trim() ||
    "";
  if (!githubToken) {
    return Response.json(
      {
        error:
          "A GitHub token is required (in the body as `token`, or set GITHUB_TOKEN). It needs Contents + Pull Requests write on the repo.",
      },
      { status: 400 },
    );
  }

  // Claude Code's auth: an explicit key override, otherwise the app's own AI
  // provider — gateway (OIDC, the sovereign default) or the configured key.
  let agentEnv: Record<string, string>;
  const keyOverride = body.anthropicKey?.trim();
  if (keyOverride) {
    agentEnv = { ANTHROPIC_API_KEY: keyOverride };
  } else {
    const resolved = await resolveSandboxAgentEnv();
    if ("error" in resolved) {
      return Response.json(
        { error: `Claude Code has no AI credential: ${resolved.error}` },
        { status: 400 },
      );
    }
    agentEnv = resolved;
  }

  const target = await getDeployTarget().catch(() => null);
  if (!target?.slug) {
    return Response.json(
      {
        error:
          "No target repo resolved. On Vercel it's auto-detected; otherwise set Config → Developer → Repo (owner/repo).",
      },
      { status: 400 },
    );
  }

  // Record the job via direct SQL (createSandboxJob self-applies the migration
  // on first use, avoiding the PostgREST schema-cache staleness that a REST
  // insert hits right after the table is created), then run it after responding.
  const userId = authed.userId;
  let jobId: string;
  try {
    jobId = await createSandboxJob(userId, task);
  } catch (e) {
    return Response.json(
      { error: `Could not start the job: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 500 },
    );
  }
  const maxTurns = typeof body.maxTurns === "number" ? body.maxTurns : undefined;
  // Resolve the OIDC token now, in the request context, so the sandbox can
  // authenticate when the run executes post-response.
  const vercelOidcToken = await resolveVercelOidcToken();

  // The long part runs after the response is sent. It records the outcome via
  // direct SQL (completeSandboxJob), scoped by id + user_id — no session or
  // schema-cache dependency post-response. The client polls GET for it.
  after(async () => {
    const result = await runCodingAgent({
      target,
      task,
      githubToken,
      agentEnv,
      vercelOidcToken,
      maxTurns,
    });
    try {
      await completeSandboxJob(userId, jobId, {
        ok: result.ok,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        error: result.error,
      });
    } catch {
      /* the job row stays "running"; the UI surfaces that as "check GitHub" */
    }
  });

  return Response.json({ jobId, status: "running", repo: target.slug });
}

export async function GET(req: Request) {
  const authed = await getAuthed();
  if (!authed) return new Response("Not signed in.", { status: 401 });

  const jobId = new URL(req.url).searchParams.get("jobId") ?? undefined;
  const job = await getSandboxJob(authed.userId, jobId).catch(() => null);
  return Response.json({ job });
}
