"use client";

import { useCallback, useEffect, useState } from "react";

type Config = {
  configured: boolean;
  connected: boolean;
  clientId: string | null;
  scopes: string[];
  needsMigration?: boolean;
};

const inputClass =
  "w-full rounded-control border bg-transparent px-3 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-3";

function looksLikeSchemaGap(message: string | null | undefined): boolean {
  if (!message) return false;
  return /chief_front_|front_oauth|does not exist|schema cache|migration|database update|Could not find the (table|function)/i.test(
    message,
  );
}

export default function FrontOfficialConnection() {
  const [config, setConfig] = useState<Config | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("/api/front/callback");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/front/config", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      config?: Config;
      error?: string;
    };
    if (!response.ok || !body.config) {
      const message = body.error || "Couldn't load Front setup.";
      if (looksLikeSchemaGap(message)) setNeedsMigration(true);
      throw new Error(message);
    }
    setNeedsMigration(Boolean(body.config.needsMigration));
    setConfig(body.config);
    setClientId(body.config.clientId ?? "");
  }, []);

  useEffect(() => {
    setRedirectUri(`${window.location.origin}/api/front/callback`);
    const message = new URLSearchParams(window.location.search).get("front_error");
    if (message) setError(message);
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Couldn't load Front setup."),
    );
  }, [load]);

  const applyMigration = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/setup/migrate", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        applied?: string[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Couldn't apply the database update.");
      }
      await load();
      setNeedsMigration(false);
      setError(null);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Couldn't apply the database update.";
      setNeedsMigration(true);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/front/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        config?: Config;
        error?: string;
      };
      if (!response.ok || !body.config) {
        const message = body.error || "Couldn't save Front setup.";
        if (looksLikeSchemaGap(message)) setNeedsMigration(true);
        throw new Error(message);
      }
      setNeedsMigration(false);
      setConfig(body.config);
      setClientSecret("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save Front setup.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/front/config", { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Couldn't disconnect Front.");
      setConfig({ configured: false, connected: false, clientId: null, scopes: [] });
      setClientId("");
      setClientSecret("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't disconnect Front.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-card border p-4"
      style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: config?.connected ? "var(--ok)" : "var(--copper)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold text-ink">
            Front official MCP
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            Connect Chief directly to Front&apos;s hosted MCP server. Your app secret
            and OAuth tokens are write-only and encrypted in Supabase Vault.
          </p>
        </div>
        <a
          href="https://dev.frontapp.com/docs/mcp-server"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[12px] font-semibold text-teal"
        >
          Front guide ↗
        </a>
      </div>

      <div
        className="rounded-control border p-3 text-[12px] leading-relaxed text-ink-3"
        style={{ borderColor: "var(--hairline)" }}
      >
        In Front, keep only <strong className="text-ink">MCP Server</strong> under
        Feature Access, set Resource permissions (Read / Write / Send) there, and
        add this Redirect URL:
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(redirectUri)}
          className="mt-2 block w-full truncate rounded-chip border px-2.5 py-2 text-left font-mono text-[11px] text-ink"
          style={{ borderColor: "var(--hairline)" }}
          title="Copy redirect URL"
        >
          {redirectUri}
        </button>
      </div>

      {needsMigration && (
        <div
          className="flex flex-col gap-3 rounded-control border p-3"
          style={{ borderColor: "var(--hairline)" }}
        >
          <div className="text-[13.5px] font-semibold text-ink">
            One quick database update
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            Official Front MCP needs a table and Vault RPCs that aren&apos;t in this
            database yet. This applies pending migrations on your own Supabase —
            Front Read / Write / Send settings do not affect this step.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyMigration()}
            className="h-11 rounded-control px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            {busy ? "Applying…" : "Apply database update"}
          </button>
        </div>
      )}

      {config?.connected ? (
        <>
          <div
            className="flex items-center justify-between rounded-control border p-3"
            style={{ borderColor: "var(--hairline)" }}
          >
            <div>
              <div className="text-[13.5px] font-semibold text-ink">Connected</div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-3">
                feature:mcp
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="rounded-chip border px-3 py-2 text-[12px] font-semibold text-ink-2 disabled:opacity-50"
              style={{ borderColor: "var(--hairline)" }}
            >
              Disconnect
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-3">
            Official Front tools now replace Pipedream Front for Chief chat and the
            Front Inbox. Pipedream remains available for other apps.
          </p>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            OAuth client ID
            <input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="From Front → Developers → OAuth"
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            OAuth client secret
            <input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={config?.configured ? "Paste again to replace setup" : "Write-only"}
              autoComplete="new-password"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            Chief requests the OAuth scope Front&apos;s authorization server
            advertises (today <span className="font-mono">feature:mcp</span>). Set
            Read / Write / Send under the Front developer app&apos;s Resource
            permissions — those are not OAuth scopes, even though Front&apos;s docs
            still mention them that way.
          </p>

          {config?.configured ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                window.location.href = "/api/front/connect";
              }}
              className="h-11 rounded-control px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--teal)" }}
            >
              Authorize with Front
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !clientId.trim() || !clientSecret.trim()}
              onClick={() => void save()}
              className="h-11 rounded-control px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--teal)" }}
            >
              {busy ? "Saving…" : "Save app credentials"}
            </button>
          )}
          {config?.configured && (
            <button
              type="button"
              disabled={busy || !clientSecret.trim()}
              onClick={() => void save()}
              className="text-[12px] font-semibold text-ink-3 disabled:opacity-40"
            >
              Replace app credentials
            </button>
          )}
        </>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-control border px-3 py-2.5 text-[12px] leading-relaxed"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
