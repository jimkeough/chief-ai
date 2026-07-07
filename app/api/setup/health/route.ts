// GET /api/setup/health — the pre-auth setup status the login page renders
// from, and the endpoint entry 5 of SETUP-FRICTION asked for: "blank screen"
// must never be the way a user learns their env vars are stale.
//
// Public by design, booleans only: it says which pieces are wired, never any
// value. (The instance's existence is not a secret; before the first user it
// is claimable by whoever reaches it — see lib/setup.ts trust note.)

import { getSetupStatus } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getSetupStatus());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Setup status failed." },
      { status: 500 },
    );
  }
}
