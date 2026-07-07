// POST /api/setup/create-user — create THE user of this deployment, in-app,
// so nobody has to find the Supabase dashboard's Add-user form (or trip over
// its autoconfirm toggle; SETUP-FRICTION entry 3). Hard rule: only while the
// instance has zero users. The single-user model is unchanged — this endpoint
// permanently locks itself the moment it succeeds once.

import { createAdminClient } from "@/lib/supabase/admin";
import { getSetupStatus } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const status = await getSetupStatus();
    if (!status.env.supabaseServiceKey) {
      return Response.json(
        {
          error:
            "No service key is set — create your user in the Supabase dashboard instead (Authentication → Add user, with autoconfirm on).",
        },
        { status: 500 },
      );
    }
    if (status.users !== 0) {
      return Response.json(
        { error: "This deployment already has its user. Sign in instead." },
        { status: 403 },
      );
    }
    // Safety net: never create a login against a schema-less database, or the
    // account exists but every app screen errors (dogfood #2). The database
    // must be set up first; only "ready" clears this gate.
    if (status.schema !== "ready") {
      return Response.json(
        { error: "Set up the database first — then create your login." },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = body.email?.trim() ?? "";
    const password = body.password ?? "";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ error: "Enter a valid email." }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // the dashboard's invisible autoconfirm trap, handled
    });
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not create the user." },
      { status: 500 },
    );
  }
}
