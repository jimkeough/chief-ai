// POST /api/setup/migrate — run the repo's own migrations against the user's
// database. Two callers are legitimate:
//   - the unclaimed first render (fresh deploy, empty schema, zero users);
//   - the signed-in owner, after pulling an upstream update that added files
//     to supabase/migrations/ ("the app runs pending migrations" commitment).
// Anyone else gets a 403.

import { createClient } from "@/lib/supabase/server";
import { getSetupStatus, isUnclaimed, runMigrations } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const status = await getSetupStatus();
    if (!status.env.supabaseUrl || !status.env.supabaseAnonKey) {
      return Response.json(
        { error: "Supabase env vars aren't wired yet — connect the database first." },
        { status: 400 },
      );
    }
    let allowed = isUnclaimed(status);
    if (!allowed) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      allowed = Boolean(user);
    }
    if (!allowed) {
      return Response.json(
        { error: "Setup is finished — sign in to run migrations." },
        { status: 403 },
      );
    }

    const applied = await runMigrations();
    return Response.json({ applied });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Migration failed." },
      { status: 500 },
    );
  }
}
