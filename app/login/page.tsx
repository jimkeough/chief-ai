"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// First render IS onboarding (SETUP-FRICTION, the day-0 rule): this page
// looks at /api/setup/health and renders whichever moment the instance is in —
// env not wired → plain-language explanation; empty schema → one-tap database
// setup; zero users → create YOUR login right here; otherwise → sign in.
// The account is created in-app via the admin API; nobody visits the Supabase
// dashboard on the happy path.

type Health = {
  env: {
    supabaseUrl: boolean;
    supabaseAnonKey: boolean;
    supabaseServiceKey: boolean;
    databaseUrl: boolean;
  };
  schema: "ready" | "missing" | "unknown";
  users: number | null;
  ready: boolean;
};

type Phase = "loading" | "env" | "database" | "claim" | "signin";

function phaseFor(h: Health | null): Phase {
  if (!h) return "signin"; // health unreachable → fail open to plain sign-in
  if (!h.env.supabaseUrl || !h.env.supabaseAnonKey) return "env";
  if (h.schema === "missing") return "database";
  if (h.users === 0) return "claim";
  return "signin";
}

export default function LoginPage() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/health", { cache: "no-store" });
      const h = (await res.json()) as Health;
      setHealth(h);
      setPhase(phaseFor(res.ok ? h : null));
    } catch {
      setHealth(null);
      setPhase("signin");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function setUpDatabase() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/migrate", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Database setup failed.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Database setup failed.");
    }
    setBusy(false);
  }

  async function createLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not create the login.");
      // Straight into the app — same credentials, no second form.
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error(error.message);
      router.push("/");
      router.refresh();
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the login.");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-card border border-teal-border bg-teal-dim font-serif text-[30px] font-medium text-teal">
            C
          </div>
          <div className="text-center">
            <h1 className="font-serif text-[28px] font-medium leading-tight text-ink">Chief</h1>
            <p className="chief-voice mt-1 text-base text-ink-2">
              A chief of staff in your pocket.
            </p>
          </div>
        </div>

        {phase === "loading" && (
          <div className="rounded-card border border-hairline bg-surface p-5 text-center text-body text-ink-2">
            Checking this deployment…
          </div>
        )}

        {phase === "env" && health && (
          <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-5">
            <h2 className="text-body font-medium text-ink">
              Almost there — the database isn&apos;t wired up yet
            </h2>
            <p className="text-label text-ink-2">
              This deployment can&apos;t see its Supabase project. Missing:
            </p>
            <ul className="list-disc pl-5 text-label text-ink-2">
              {!health.env.supabaseUrl && <li>NEXT_PUBLIC_SUPABASE_URL</li>}
              {!health.env.supabaseAnonKey && (
                <li>
                  NEXT_PUBLIC_SUPABASE_ANON_KEY (or
                  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
                </li>
              )}
            </ul>
            <p className="text-label text-ink-2">
              If you deployed with the one-click button, open your Vercel
              project → Storage and connect the Supabase database it created.
              If you added env vars by hand just now, redeploy — Vercel only
              applies them to new deployments.
            </p>
            <button
              onClick={() => void refresh()}
              className="mt-1 h-12 rounded-control font-medium text-[16px]"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              Check again
            </button>
          </div>
        )}

        {phase === "database" && health && (
          <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-5">
            <h2 className="text-body font-medium text-ink">
              Your database is connected — let&apos;s set it up
            </h2>
            {health.env.databaseUrl ? (
              <>
                <p className="text-label text-ink-2">
                  One tap runs Chief&apos;s schema on your own Supabase
                  project. Nothing leaves your accounts.
                </p>
                <button
                  onClick={() => void setUpDatabase()}
                  disabled={busy}
                  className="mt-1 h-12 rounded-control font-medium text-[16px] disabled:opacity-60"
                  style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                >
                  {busy ? "Setting up…" : "Set up my database"}
                </button>
              </>
            ) : (
              <>
                <p className="text-label text-ink-2">
                  No direct database URL is set, so run it by hand once: open
                  your Supabase project&apos;s SQL editor and paste each file
                  from <code>supabase/migrations/</code> in filename order.
                </p>
                <button
                  onClick={() => void refresh()}
                  disabled={busy}
                  className="mt-1 h-12 rounded-control font-medium text-[16px] disabled:opacity-60"
                  style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                >
                  I&apos;ve run them — check again
                </button>
              </>
            )}
            {error && <p className="text-label text-danger">{error}</p>}
          </div>
        )}

        {phase === "claim" && health && (
          <>
            {health.env.supabaseServiceKey ? (
              <form
                onSubmit={createLogin}
                className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-5"
              >
                <h2 className="text-body font-medium text-ink">
                  Create your login
                </h2>
                <p className="text-label text-ink-2">
                  This instance is yours. One account, created right here —
                  you&apos;ll use it to sign in from now on.
                </p>
                <label className="flex flex-col gap-1.5">
                  <span className="text-micro text-ink-3">EMAIL</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 rounded-control border border-hairline bg-raised px-3.5 text-body text-ink placeholder:text-ink-3"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-micro text-ink-3">
                    PASSWORD (8+ CHARACTERS)
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-control border border-hairline bg-raised px-3.5 text-body text-ink"
                  />
                </label>
                {error && <p className="text-label text-danger">{error}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-1 h-12 rounded-control font-medium text-[16px] disabled:opacity-60"
                  style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                >
                  {busy ? "Creating…" : "Create my login"}
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-5">
                <h2 className="text-body font-medium text-ink">
                  Create your login in Supabase
                </h2>
                <p className="text-label text-ink-2">
                  No service key is set, so create the account there once:
                  Supabase dashboard → Authentication → Add user — and turn ON
                  &quot;Auto Confirm User&quot; or the sign-in will fail with
                  &quot;Email not confirmed&quot;.
                </p>
                <button
                  onClick={() => setPhase("signin")}
                  className="mt-1 h-12 rounded-control font-medium text-[16px]"
                  style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                >
                  I&apos;ve created it — sign in
                </button>
              </div>
            )}
          </>
        )}

        {phase === "signin" && (
          <form
            onSubmit={signIn}
            className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-5"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-micro text-ink-3">EMAIL</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-control border border-hairline bg-raised px-3.5 text-body text-ink placeholder:text-ink-3"
                placeholder="you@example.com"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-micro text-ink-3">PASSWORD</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-control border border-hairline bg-raised px-3.5 text-body text-ink"
              />
            </label>

            {error && <p className="text-label text-danger">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 h-12 rounded-control font-medium text-[16px] disabled:opacity-60"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        <p className="text-meta mt-4 text-center text-ink-3">
          One user per deployment — yours.
        </p>
      </div>
    </div>
  );
}
