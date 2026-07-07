# Database schema

The source of truth for Chief's database lives in `supabase/migrations/`.
The app applies them itself at first render (and on demand at
`POST /api/setup/migrate`) whenever a direct `POSTGRES_URL_NON_POOLING` is
set — tracked in `supabase_migrations.schema_migrations`, the same ledger the
Supabase CLI uses, so `supabase db push`, the dashboard SQL editor, and the
in-app runner stay in agreement.

## Conventions

- **One user per deployment.** Tenancy key is `user_id uuid references
  auth.users`, defaulting to `auth.uid()` on insert. There is no allowlist and
  no roles table — whoever the single Supabase Auth user is owns every row.
- **RLS does the real work.** App code talks to Postgres through the user's
  session client (anon key + auth cookie). Every table has RLS with
  `user_id = auth.uid()` policies. The service role is reserved for
  setup/migration scripts, never hot paths.
- **`communications` is append-only.** RLS grants `select` + `insert` only —
  no update/delete policies exist, so the app physically cannot rewrite
  history.

## Setup for a fresh deployment

1. Create a Supabase project (the one-click deploy button does this for you
   via the Vercel Marketplace).
2. Put the project URL + keys in the env (see `.env.example`) — injected
   automatically on a one-click deployment.
3. Open the app: first render runs the migrations and creates your one user
   in-app. There is no sign-up flow by design — the create-login screen locks
   itself the moment the first user exists.

Manual fallback (no service key / no Postgres URL set): run each file in
`migrations/` in filename order in the SQL editor, then Dashboard →
Authentication → Add user (email + password, autoconfirm).
