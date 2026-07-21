// POST /api/dev/sandbox-agent — the Phase 2 orchestrator flow (SANDBOX-PLAN.md).
// Owner-authed and gated behind `devmode.sandbox_enabled`. Given a task, it spins
// up an ephemeral Vercel Sandbox, installs Claude Code, lets it edit the checkout
// on a fresh branch, commits + pushes, and opens a DRAFT PR — then tears the VM
// down. Returns the PR link (or a precise failure).
//
// This is the "Chief orchestrates, Claude Code engineers, you merge" loop. The
// VM is a throwaway clone: the agent's edits are not production writes, and the
// only thing that reaches the repo is the PR you review. Nothing deploys until
// you merge.
//
// It can't be exercised from a dev container / CI (the Sandbox SDK needs the
// Vercel runtime + OIDC token) — verify on a preview deploy.
//
// KNOWN LIMITATION (called out in the plan): a full run (install + agent turns +
// build) can exceed a serverless function's max-duration. On Hobby (60s) this
// will time out for non-trivial tasks; a durable version backgrounds the run and
// reports the PR asynchronously. Kept synchronous here so Phase 2 is verifiable
// end to end first.
//
// Body: {
//   "task": "<what to change>",           // required
//   "token": "<github token>",            // optional; else GITHUB_TOKEN env
//   "anthropicKey": "<key>",              // optional; else setting / env
//   "maxTurns": 30                        // optional
// }

import { getAuthed } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { getDeployTarget } from "@/lib/deploy-target";
import {
  getConnectedGithubToken,
  isSandboxConfigured,
  isSandboxEnabled,
  runCodingAgent,
} from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Best-effort ceiling; the platform caps this to the plan's limit (60s on Hobby).
// See the KNOWN LIMITATION note above — long runs need to be backgrounded.
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

  const anthropicKey =
    body.anthropicKey?.trim() ||
    (await getSetting("ai.byok_anthropic_key").catch(() => "")).trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    "";
  if (!anthropicKey) {
    return Response.json(
      {
        error:
          "An Anthropic API key is required to run Claude Code (body `anthropicKey`, the Config BYOK key, or ANTHROPIC_API_KEY). Gateway/OIDC-only setups aren't wired for the in-VM agent yet.",
      },
      { status: 400 },
    );
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

  const result = await runCodingAgent({
    target,
    task,
    githubToken,
    anthropicKey,
    maxTurns: typeof body.maxTurns === "number" ? body.maxTurns : undefined,
  });

  return Response.json({ repo: target.slug, ...result }, {
    status: result.ok ? 200 : 422,
  });
}
