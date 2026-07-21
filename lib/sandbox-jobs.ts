// Persistence for backgrounded sandbox Run jobs (SANDBOX-PLAN.md).
//
// These go through a DIRECT Postgres connection, NOT the Supabase REST client,
// on purpose: right after the sandbox_jobs table is first created (by
// runMigrations), PostgREST's schema cache is still stale and a REST insert
// fails with "Could not find the table 'public.sandbox_jobs' in the schema
// cache". Direct SQL has no schema cache in the path (same reasoning lib/setup
// uses for its table-existence check), so create → insert works immediately.
//
// The app is single-user and the caller is the owner (route is auth-gated), so
// rows are scoped by user_id in SQL rather than via RLS.

import type { Client } from "pg";
import { supabaseDbUrl } from "@/lib/supabase/env";
import { pgClient } from "@/lib/setup";

// Create ONLY this feature's table, idempotently — never a full migration
// replay (that can re-run old, non-idempotent migrations when the migration
// ledger is out of sync, and fail on objects that already exist). RLS is
// enabled with no policies so any accidental REST access fails closed; all real
// access here is direct SQL, which bypasses RLS. updated_at is set explicitly in
// completeSandboxJob, so no trigger is needed. Mirrors
// supabase/migrations/20260721120000_sandbox_jobs.sql (which adds the trigger +
// policies for the REST/RLS-based setup path).
const ENSURE_SANDBOX_JOBS_SQL = `
  create table if not exists public.sandbox_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    task text not null,
    status text not null default 'running'
      check (status in ('running', 'done', 'error')),
    pr_url text,
    pr_number integer,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists sandbox_jobs_user_updated_idx
    on public.sandbox_jobs (user_id, updated_at desc);
  alter table public.sandbox_jobs enable row level security;
`;

export type SandboxJob = {
  id: string;
  task: string;
  status: "running" | "done" | "error";
  prUrl: string | null;
  prNumber: number | null;
  error: string | null;
  updatedAt: string;
};

export type SandboxJobOutcome = {
  ok: boolean;
  prUrl: string | null;
  prNumber: number | null;
  error?: string;
};

async function withPg<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = supabaseDbUrl();
  if (!url) {
    throw new Error("No database URL configured (POSTGRES_URL_NON_POOLING).");
  }
  const client = pgClient(url);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Insert a running job and return its id. If the table doesn't exist yet (a
 *  deploy shipped the migration but it hasn't been applied), apply pending
 *  migrations and retry on the same connection — no PostgREST cache to go
 *  stale, so the retry sees the new table immediately. */
export async function createSandboxJob(
  userId: string,
  task: string,
): Promise<string> {
  return withPg(async (client) => {
    const insert = () =>
      client.query<{ id: string }>(
        `insert into public.sandbox_jobs (user_id, task, status)
         values ($1, $2, 'running') returning id`,
        [userId, task],
      );
    try {
      const { rows } = await insert();
      return rows[0].id;
    } catch (e) {
      if (/relation .*sandbox_jobs.* does not exist/i.test(String(e))) {
        // Create just this table (idempotent) on the same connection, then
        // retry — no PostgREST cache, no full migration replay.
        await client.query(ENSURE_SANDBOX_JOBS_SQL);
        const { rows } = await insert();
        return rows[0].id;
      }
      throw e;
    }
  });
}

/** Record a job's final outcome (owner-scoped). */
export async function completeSandboxJob(
  userId: string,
  jobId: string,
  outcome: SandboxJobOutcome,
): Promise<void> {
  await withPg((client) =>
    client.query(
      `update public.sandbox_jobs
         set status = $1, pr_url = $2, pr_number = $3, error = $4, updated_at = now()
       where id = $5 and user_id = $6`,
      [
        outcome.ok ? "done" : "error",
        outcome.prUrl,
        outcome.prNumber,
        outcome.error ?? null,
        jobId,
        userId,
      ],
    ),
  );
}

/** Fetch a job by id, or the caller's most recent job when no id is given. */
export async function getSandboxJob(
  userId: string,
  jobId?: string,
): Promise<SandboxJob | null> {
  return withPg(async (client) => {
    const cols =
      "id, task, status, pr_url, pr_number, error, updated_at";
    const { rows } = jobId
      ? await client.query(
          `select ${cols} from public.sandbox_jobs
           where user_id = $1 and id = $2 limit 1`,
          [userId, jobId],
        )
      : await client.query(
          `select ${cols} from public.sandbox_jobs
           where user_id = $1 order by updated_at desc limit 1`,
          [userId],
        );
    const r = rows[0] as
      | {
          id: string;
          task: string;
          status: SandboxJob["status"];
          pr_url: string | null;
          pr_number: number | null;
          error: string | null;
          updated_at: string | Date;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      task: r.task,
      status: r.status,
      prUrl: r.pr_url,
      prNumber: r.pr_number,
      error: r.error,
      updatedAt:
        r.updated_at instanceof Date
          ? r.updated_at.toISOString()
          : String(r.updated_at),
    };
  });
}
