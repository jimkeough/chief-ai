// First-render setup: the pre-auth concierge's engine (SETUP-FRICTION's
// "day-0 gap" rule — everything after the Deploy button belongs to the app
// itself). Three capabilities, all usable only while the instance is
// unclaimed or by its signed-in owner:
//
//  1. Assess: which env vars are wired, does the schema exist, does the one
//     user exist yet.
//  2. Migrate: run the repo's own supabase/migrations/*.sql against the
//     user's database (the Vercel Marketplace integration injects
//     POSTGRES_URL_NON_POOLING), tracked in the same table the Supabase CLI
//     uses so `supabase db push` and this runner agree on what's applied.
//  3. Claim: create the single auth user via the admin API — only ever when
//     zero users exist.
//
// Trust note: a fresh deployment is claimable by whoever reaches it first —
// that is inherent to a zero-prompt deploy (the URL is effectively a
// bearer capability until the login exists). The moment the first user is
// created, every setup mutation here refuses to run pre-auth.

import { promises as fs } from "fs";
import path from "path";
import { Client } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  supabaseAnonKey,
  supabaseDbUrl,
  supabaseServiceKey,
  supabaseUrl,
} from "@/lib/supabase/env";

export type SetupStatus = {
  env: {
    supabaseUrl: boolean;
    supabaseAnonKey: boolean;
    supabaseServiceKey: boolean;
    databaseUrl: boolean;
  };
  /** "missing" = the settings table isn't there (fresh database). */
  schema: "ready" | "missing" | "unknown";
  /** 0 = unclaimed, 1 = claimed (a floor, not a census), null = can't tell
   *  (no service key to ask with). */
  users: number | null;
  ready: boolean;
};

export async function getSetupStatus(): Promise<SetupStatus> {
  const env = {
    supabaseUrl: Boolean(supabaseUrl()),
    supabaseAnonKey: Boolean(supabaseAnonKey()),
    supabaseServiceKey: Boolean(supabaseServiceKey()),
    databaseUrl: Boolean(supabaseDbUrl()),
  };

  let schema: SetupStatus["schema"] = "unknown";
  let users: number | null = null;

  if (env.supabaseUrl && (env.supabaseAnonKey || env.supabaseServiceKey)) {
    const key = supabaseServiceKey() || supabaseAnonKey();
    const probe = createSupabaseClient(supabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await probe
      .from("settings")
      .select("key", { head: true, count: "exact" });
    if (!error) {
      schema = "ready";
    } else if (
      error.code === "42P01" || // undefined_table (raw Postgres)
      error.code === "PGRST205" || // PostgREST: table not in schema cache
      /does not exist|find the table/i.test(error.message)
    ) {
      schema = "missing";
    }

    if (env.supabaseServiceKey) {
      const { data, error: usersError } = await probe.auth.admin.listUsers({
        page: 1,
        perPage: 1,
      });
      if (!usersError) users = data.users.length;
    }
  }

  return {
    env,
    schema,
    users,
    ready:
      env.supabaseUrl &&
      env.supabaseAnonKey &&
      schema === "ready" &&
      (users ?? 0) > 0,
  };
}

/** May setup MUTATIONS (migrate / create-user) run without a session?
 *  Only while the instance is unclaimed: schema absent, or zero users. */
export function isUnclaimed(status: SetupStatus): boolean {
  return status.schema === "missing" || status.users === 0;
}

// --- The migration runner ---------------------------------------------------

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

type MigrationFile = { version: string; name: string; file: string };

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const base = file.replace(/\.sql$/, "");
      const m = base.match(/^(\d+)_?(.*)$/);
      return {
        version: m?.[1] ?? base,
        name: m?.[2] || base,
        file,
      };
    });
}

/** Apply every migration not yet recorded, in filename order, one transaction
 *  per file. Returns the filenames applied (empty = already up to date). */
export async function runMigrations(): Promise<string[]> {
  const dbUrl = supabaseDbUrl();
  if (!dbUrl) {
    throw new Error(
      "No database URL (POSTGRES_URL_NON_POOLING) is set — run the files in supabase/migrations/ by hand instead.",
    );
  }

  const files = await listMigrationFiles();
  // Supabase requires TLS but its chain isn't in Node's default CA store;
  // a local dev database usually speaks no TLS at all.
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl);
  const client = new Client({
    connectionString: dbUrl,
    ssl: local ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  const applied: string[] = [];
  try {
    // The Supabase CLI's own ledger, so the two runners stay in agreement.
    await client.query(`create schema if not exists supabase_migrations`);
    await client.query(
      `create table if not exists supabase_migrations.schema_migrations (
         version text primary key,
         statements text[],
         name text
       )`,
    );
    const { rows } = await client.query<{ version: string }>(
      `select version from supabase_migrations.schema_migrations`,
    );
    const done = new Set(rows.map((r) => r.version));

    for (const m of files) {
      if (done.has(m.version)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, m.file), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name)
           values ($1, $2) on conflict (version) do nothing`,
          [m.version, m.name],
        );
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw new Error(
          `Migration ${m.file} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      applied.push(m.file);
    }
  } finally {
    await client.end().catch(() => {});
  }
  return applied;
}
