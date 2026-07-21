// POST /api/dev/sandbox-check — the Phase 1 provisioning spike trigger
// (SANDBOX-PLAN.md). Owner-authed and gated behind `devmode.sandbox_enabled`
// (default off, Sovereign-only). It spins up an ephemeral Vercel Sandbox, clones
// THIS deployment's repo, runs a few fast read-only commands, tears the sandbox
// down, and returns the per-step results as JSON.
//
// This exists so the sandbox plumbing can be VERIFIED on a real preview deploy —
// it can't be exercised from a plain dev container (the SDK needs the Vercel
// runtime + OIDC token). It is not the coding-agent loop (Phase 2) and it never
// writes to production or to user data: the VM is a throwaway clone.
//
// Body (optional): { "token": "<github token>" } — needed only to clone a
// PRIVATE repo over HTTPS; falls back to process.env.GITHUB_TOKEN. The token is
// used only to construct the clone auth and is never echoed back.

import { getAuthed } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { getDeployTarget } from "@/lib/deploy-target";
import {
  getConnectedGithubToken,
  isSandboxConfigured,
  isSandboxEnabled,
  provisionAndCheck,
} from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Provisioning + a shallow clone + a few trivial commands must fit inside the
// function budget; the heavier build (npm ci + typecheck) is Phase 2 and runs
// backgrounded rather than awaited here.
export const maxDuration = 60;

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

  if (!isSandboxConfigured()) {
    return Response.json(
      {
        error:
          "No Vercel OIDC token is available, so the sandbox can't authenticate. This runs on a Vercel deployment (token injected automatically) or locally after `vercel env pull`.",
      },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token =
    body.token?.trim() ||
    (await getSetting("devmode.github_token").catch(() => "")).trim() ||
    (await getConnectedGithubToken()) ||
    process.env.GITHUB_TOKEN?.trim() ||
    null;

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

  const result = await provisionAndCheck({ target, token });
  return Response.json({ repo: target.slug, ...result });
}
