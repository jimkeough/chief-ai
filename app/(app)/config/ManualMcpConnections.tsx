"use client";

import { useCallback, useEffect, useState } from "react";

type Connection = {
  id: string;
  name: string;
  url: string;
  authType: "none" | "bearer";
  hasSecret: boolean;
  app: string | null;
  allowedTools: string[];
  trustReadAnnotations: boolean;
};

type ServerTool = {
  name: string;
  description: string;
  readOnly: boolean;
  mode: "auto" | "ask" | "off";
};

type Probe = {
  toolCount: number;
  autoCount: number;
  askCount: number;
  latencyMs?: number;
};

type Draft = {
  id: string | null;
  name: string;
  url: string;
  authType: "none" | "bearer";
  authorizationToken: string;
  app: string;
  allowedTools: string;
  trustReadAnnotations: boolean;
  hasSecret: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  url: "",
  authType: "none",
  authorizationToken: "",
  app: "",
  allowedTools: "",
  trustReadAnnotations: false,
  hasSecret: false,
});

const inputClass =
  "w-full rounded-control border bg-transparent px-3 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-3";

function ToolModes({
  server,
  tools,
  onChange,
}: {
  server: string;
  tools: ServerTool[];
  onChange: (server: string, tool: string, mode: "auto" | "ask" | "off") => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-control border p-3"
      style={{ borderColor: "var(--hairline)" }}
    >
      {tools.map((tool) => (
        <div key={tool.name} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px] text-ink">{tool.name}</div>
            <div className="truncate text-[11.5px] text-ink-3">
              {tool.readOnly ? "verified read" : "always asks"}
            </div>
          </div>
          {(tool.readOnly
            ? (["auto", "ask", "off"] as const)
            : (["ask", "off"] as const)
          ).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(server, tool.name, mode)}
              className="rounded-chip border px-2 py-1 font-mono text-[10px] tracking-[0.06em]"
              style={
                tool.mode === mode
                  ? {
                      background: "var(--teal-fill)",
                      color: "var(--teal-on-fill)",
                      borderColor: "transparent",
                    }
                  : { borderColor: "var(--hairline)", color: "var(--ink-3)" }
              }
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      ))}
      {tools.length === 0 && (
        <div className="text-[13px] text-ink-3">No tools exposed.</div>
      )}
    </div>
  );
}

export default function ManualMcpConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeFor, setProbeFor] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  const [tools, setTools] = useState<ServerTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/connections");
      const body = (await response.json().catch(() => ({}))) as {
        connections?: Connection[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Couldn't load MCP connections.");
      setConnections(body.connections ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load MCP connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/mcp/connections/migrate", { method: "POST" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (active && (!response.ok || body.ok === false)) {
          setError(body.error ?? "Legacy MCP connections could not be migrated.");
        }
      })
      .catch(() => {
        if (active) setError("Legacy MCP connections could not be migrated.");
      })
      .finally(() => {
        if (active) void refresh();
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const edit = (connection: Connection) => {
    setError(null);
    setDraft({
      id: connection.id,
      name: connection.name,
      url: connection.url,
      authType: connection.authType,
      authorizationToken: "",
      app: connection.app ?? "",
      allowedTools: connection.allowedTools.join(", "),
      trustReadAnnotations: connection.trustReadAnnotations,
      hasSecret: connection.hasSecret,
    });
  };

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: draft.name,
        url: draft.url,
        authType: draft.authType,
        ...(draft.authorizationToken
          ? { authorizationToken: draft.authorizationToken }
          : {}),
        clearAuthorizationToken: draft.authType === "none" && draft.hasSecret,
        app: draft.app,
        allowedTools: draft.allowedTools
          .split(",")
          .map((tool) => tool.trim())
          .filter(Boolean),
        trustReadAnnotations: draft.trustReadAnnotations,
      };
      const response = await fetch(
        draft.id ? `/api/mcp/connections/${draft.id}` : "/api/mcp/connections",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        connection?: Connection;
        probe?: Probe;
        error?: string;
      };
      if (!response.ok || !body.connection) {
        throw new Error(body.error ?? "Couldn't save MCP connection.");
      }
      if (body.probe) {
        setProbes((current) => ({ ...current, [body.connection!.id]: body.probe! }));
      }
      setDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save MCP connection.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (connection: Connection) => {
    if (!window.confirm(`Remove ${connection.name} and its stored credential?`)) return;
    setError(null);
    const response = await fetch(`/api/mcp/connections/${connection.id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Couldn't remove MCP connection.");
      return;
    }
    if (draft?.id === connection.id) setDraft(null);
    setToolsFor(null);
    setTools(null);
    await refresh();
  };

  const testConnection = async (id: string) => {
    setProbeFor(id);
    setError(null);
    const response = await fetch(`/api/mcp/connections/${id}/test`, {
      method: "POST",
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as Probe & {
      ok?: boolean;
      error?: string;
    };
    setProbeFor(null);
    if (!response?.ok || !body.ok) {
      setError(body.error ?? "Connection test failed.");
      return;
    }
    setProbes((current) => ({ ...current, [id]: body }));
  };

  const loadTools = async (server: string) => {
    if (toolsFor === server) {
      setToolsFor(null);
      setTools(null);
      return;
    }
    setToolsFor(server);
    setTools(null);
    setToolsError(null);
    const response = await fetch(
      `/api/mcp/tools?server=${encodeURIComponent(server)}`,
    ).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      tools?: ServerTool[];
      error?: string;
    };
    if (body.ok) setTools(body.tools ?? []);
    else setToolsError(body.error ?? "Couldn't list tools.");
  };

  const setToolMode = async (
    server: string,
    tool: string,
    mode: "auto" | "ask" | "off",
  ) => {
    setTools(
      (current) =>
        current?.map((item) => (item.name === tool ? { ...item, mode } : item)) ??
        null,
    );
    await fetch("/api/mcp/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server, tool, mode }),
    }).catch(() => {});
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-card border p-4"
      style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
    >
      <div className="text-[12.5px] leading-snug text-ink-3">
        Connect any remote MCP server. Credentials are write-only, encrypted in
        Supabase Vault, and never shown to Chief or returned to this browser.
      </div>

      {error && (
        <div
          className="rounded-control border px-3 py-2 text-[12.5px]"
          style={{
            borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {loading && <div className="text-[13px] text-ink-3">Loading connections…</div>}
      {!loading && connections.length === 0 && !draft && (
        <div className="text-[13.5px] text-ink-2">No direct MCP servers yet.</div>
      )}

      {connections.map((connection) => {
        const expanded = toolsFor === connection.name;
        const probe = probes[connection.id];
        return (
          <div key={connection.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: probe ? "var(--ok)" : "var(--ink-3)" }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] text-ink">{connection.name}</div>
                <div className="truncate font-mono text-[10.5px] text-ink-3">
                  {connection.url}
                </div>
                <div className="font-mono text-[10px] tracking-[0.04em] text-ink-3">
                  {connection.hasSecret ? "CREDENTIAL SAVED" : "NO CREDENTIAL"}
                  {probe ? ` · ${probe.toolCount} TOOLS` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void testConnection(connection.id)}
                disabled={probeFor === connection.id}
                className="shrink-0 font-mono text-[10.5px] tracking-[0.05em] text-teal disabled:opacity-50"
              >
                {probeFor === connection.id ? "TESTING…" : "TEST"}
              </button>
              <button
                type="button"
                onClick={() => void loadTools(connection.name)}
                className="shrink-0 font-mono text-[10.5px] tracking-[0.05em] text-teal"
              >
                TOOLS {expanded ? "▴" : "▾"}
              </button>
            </div>

            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={() => edit(connection)}
                className="font-mono text-[10.5px] tracking-[0.05em] text-ink-3"
              >
                EDIT
              </button>
              <button
                type="button"
                onClick={() => void remove(connection)}
                className="font-mono text-[10.5px] tracking-[0.05em] text-ink-3"
              >
                REMOVE
              </button>
            </div>

            {expanded && (
              <>
                {tools === null && !toolsError && (
                  <div className="text-[13px] text-ink-3">Listing tools…</div>
                )}
                {toolsError && (
                  <div className="text-[13px]" style={{ color: "var(--danger)" }}>
                    {toolsError}
                  </div>
                )}
                {tools && (
                  <ToolModes
                    server={connection.name}
                    tools={tools}
                    onChange={(server, tool, mode) =>
                      void setToolMode(server, tool, mode)
                    }
                  />
                )}
              </>
            )}
            <div className="h-px" style={{ background: "var(--hairline)" }} />
          </div>
        );
      })}

      {draft && (
        <div className="flex flex-col gap-3">
          <div className="text-[14px] font-semibold text-ink">
            {draft.id ? "Edit MCP connection" : "Add MCP connection"}
          </div>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Name
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              placeholder="front"
              autoComplete="off"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            MCP server URL
            <input
              value={draft.url}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, url: event.target.value } : current,
                )
              }
              placeholder="https://mcp.example.com/mcp"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Authentication
            <select
              value={draft.authType}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        authType: event.target.value === "bearer" ? "bearer" : "none",
                      }
                    : current,
                )
              }
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            >
              <option value="none">No authentication</option>
              <option value="bearer">Bearer token</option>
            </select>
          </label>
          {draft.authType === "bearer" && (
            <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
              Secret token
              <input
                type="password"
                value={draft.authorizationToken}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, authorizationToken: event.target.value }
                      : current,
                  )
                }
                placeholder={draft.hasSecret ? "Saved — leave blank to keep" : "Paste token"}
                autoComplete="new-password"
                className={inputClass}
                style={{ borderColor: "var(--hairline)" }}
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            App slug <span className="text-[11px]">(optional)</span>
            <input
              value={draft.app}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, app: event.target.value } : current,
                )
              }
              placeholder="frontapp"
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Allowed tools <span className="text-[11px]">(optional, comma-separated)</span>
            <input
              value={draft.allowedTools}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, allowedTools: event.target.value } : current,
                )
              }
              placeholder="search, list_items"
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex items-start gap-2.5 text-[12.5px] leading-snug text-ink-2">
            <input
              type="checkbox"
              checked={draft.trustReadAnnotations}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, trustReadAnnotations: event.target.checked }
                    : current,
                )
              }
              className="mt-0.5"
            />
            Let tools marked read-only run automatically. Leave off for unknown
            servers so every tool asks first.
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="h-11 flex-1 rounded-control border text-[14px] text-ink-2"
              style={{ borderColor: "var(--hairline)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="h-11 flex-1 rounded-control text-[14px] font-semibold disabled:opacity-50"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy ? "Connecting…" : draft.id ? "Save" : "Test & save"}
            </button>
          </div>
        </div>
      )}

      {!draft && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDraft(emptyDraft());
          }}
          className="flex h-11 items-center justify-center rounded-control text-[14.5px] font-semibold"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          Add MCP connection
        </button>
      )}
    </div>
  );
}

