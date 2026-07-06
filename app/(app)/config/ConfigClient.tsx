"use client";

// Config — the app's control room, in the established design vocabulary
// (mono section labels, surface cards, teal accents; no spec screen exists
// for this one). Sections: setup checklist (until complete), connections,
// Chief settings (SETTING_DEFS rendered automatically), standing
// instructions, memory, diagnostics, account.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useChief, SETUP_INTERVIEW_PROMPT } from "@/app/components/ChiefProvider";

type SettingDef = {
  key: string;
  label: string;
  description: string;
  default: string;
  singleLine?: boolean;
  rows?: number;
  placeholder?: string;
};

type Status = {
  account: string | null;
  env: { anthropic: boolean; voyage: boolean; googleOauth: boolean };
  mail:
    | { connected: true; provider: "imap" | "gmail-mcp"; account: string | null }
    | { connected: false };
  counts: {
    projects: number;
    openTasks: number;
    memory: number;
    instructions: number;
    contacts: number;
  };
};

type KbDoc = { id: string; title: string; updated_at: string };

type ConnectStatus = {
  configured: boolean;
  apps?: string[];
  accounts?: { id: string; app: string; name?: string; healthy: boolean }[];
  error?: string;
};

type CatalogApp = { slug: string; name: string; description?: string; img?: string };

type ServerTool = {
  name: string;
  description: string;
  readOnly: boolean;
  mode: "auto" | "ask" | "off";
};

const card =
  "flex flex-col gap-3 rounded-card border p-4";
const cardStyle = {
  borderColor: "var(--hairline)",
  background: "var(--surface)",
} as const;
const inputCls =
  "w-full rounded-control border bg-transparent px-3 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-3";

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-mono text-[11px] tracking-[0.12em] text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ background: ok ? "var(--ok)" : "var(--copper)" }}
      aria-hidden="true"
    />
  );
}

export default function ConfigClient() {
  const { openAndSend } = useChief();
  const [status, setStatus] = useState<Status | null>(null);
  const [defs, setDefs] = useState<SettingDef[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instructions, setInstructions] = useState<KbDoc[]>([]);
  const [memory, setMemory] = useState<KbDoc[]>([]);
  const [newRule, setNewRule] = useState("");
  const [connect, setConnect] = useState<ConnectStatus | null>(null);

  const refresh = useCallback(async () => {
    const [s, st, ins, mem, con] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()).catch(() => null),
      fetch("/api/config/status").then((r) => r.json()).catch(() => null),
      fetch("/api/kb?kind=instruction").then((r) => r.json()).catch(() => null),
      fetch("/api/kb?kind=fact").then((r) => r.json()).catch(() => null),
      fetch("/api/connect").then((r) => r.json()).catch(() => null),
    ]);
    if (s) {
      setDefs(s.defs ?? []);
      setSettings(s.settings ?? {});
    }
    if (st) setStatus(st as Status);
    if (ins) setInstructions((ins.documents ?? []) as KbDoc[]);
    if (mem) setMemory(((mem.documents ?? []) as KbDoc[]).slice(0, 20));
    if (con) setConnect(con as ConnectStatus);
  }, []);

  // --- Catalog search + per-account tool lists ------------------------------
  const [appQuery, setAppQuery] = useState("");
  const [appResults, setAppResults] = useState<CatalogApp[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  const [tools, setTools] = useState<ServerTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const searchApps = async () => {
    const q = appQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/connect/apps?q=${encodeURIComponent(q)}`);
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        apps?: CatalogApp[];
      };
      setAppResults(body.ok ? (body.apps ?? []) : []);
    } finally {
      setSearching(false);
    }
  };

  const enableApp = async (slug: string) => {
    const res = await fetch("/api/connect/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      url?: string;
    };
    if (body?.ok && body.url) window.open(body.url, "_blank", "noopener");
    setAppResults(null);
    setAppQuery("");
    await refresh();
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
    const res = await fetch(
      `/api/connect/tools?server=${encodeURIComponent(server)}`,
    ).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      tools?: ServerTool[];
      error?: string;
    };
    if (body?.ok) setTools(body.tools ?? []);
    else setToolsError(body?.error ?? "Couldn't list tools.");
  };

  const setToolMode = async (
    server: string,
    tool: string,
    mode: "auto" | "ask" | "off",
  ) => {
    setTools(
      (ts) => ts?.map((t) => (t.name === tool ? { ...t, mode } : t)) ?? null,
    );
    await fetch("/api/connect/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server, tool, mode }),
    }).catch(() => {});
  };

  const openConnectLink = async (app: string) => {
    const res = await fetch("/api/connect/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { ok?: boolean; url?: string };
    if (body?.ok && body.url) window.open(body.url, "_blank", "noopener");
  };

  const disconnectAccount = async (accountId: string) => {
    await fetch("/api/connect/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    }).catch(() => {});
    await refresh();
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const addInstruction = async () => {
    const body = newRule.trim();
    if (!body) return;
    // Title = first ~6 words of the rule.
    const title = body.split(/\s+/).slice(0, 6).join(" ");
    await fetch("/api/kb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, kind: "instruction" }),
    }).catch(() => {});
    setNewRule("");
    await refresh();
  };

  const deleteDoc = async (id: string) => {
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => {});
    await refresh();
  };

  const setupItems = status
    ? [
        { ok: status.env.anthropic, label: "Anthropic API key (Vercel env)" },
        { ok: status.mail.connected, label: "Email connected", href: "/inbox" },
        { ok: status.counts.projects > 0, label: "First project created" },
        {
          ok: status.counts.instructions > 0,
          label: "A standing instruction saved",
        },
      ]
    : [];
  const setupDone = setupItems.every((i) => i.ok);

  return (
    <div className="flex flex-col gap-6 pt-2 pb-8">
      <div className="flex items-center justify-between">
        <div className="text-micro text-ink-3">CONFIG</div>
        <Link href="/" className="font-mono text-[11px] tracking-[0.08em] text-ink-3">
          ← HOME
        </Link>
      </div>

      {/* Setup: the on-demand concierge, plus the checklist until it's done. */}
      <Section label="SETUP">
        <div className={card} style={cardStyle}>
          {status && !setupDone && (
            <>
              {setupItems.map((i) => (
                <div key={i.label} className="flex items-center gap-3">
                  <Dot ok={i.ok} />
                  <div className="flex-1 text-[14.5px] text-ink">{i.label}</div>
                  {!i.ok && i.href && (
                    <Link href={i.href} className="text-[13px] font-semibold text-teal">
                      connect →
                    </Link>
                  )}
                </div>
              ))}
              <div className="h-px" style={{ background: "var(--hairline)" }} />
            </>
          )}
          <button
            onClick={() => openAndSend(SETUP_INTERVIEW_PROMPT)}
            className="flex h-12 items-center justify-center gap-2 rounded-control text-[15px] font-semibold"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            <span className="font-serif text-[17px] italic">C</span>
            Set up with Chief
          </button>
          <p className="text-[13px] leading-relaxed text-ink-2">
            A short interview — Chief asks about your work one question at a
            time and proposes the projects, tasks, contacts, and rules to
            capture it. Run it any time; everything it suggests still needs
            your approval.
          </p>
        </div>
      </Section>

      {/* Connections */}
      <Section label="CONNECTIONS">
        <div className={card} style={cardStyle}>
          <div className="flex items-center gap-3">
            <Dot ok={Boolean(status?.mail.connected)} />
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] text-ink">Email</div>
              <div className="truncate font-mono text-[11px] text-ink-3">
                {status?.mail.connected
                  ? `${status.mail.provider === "imap" ? "IMAP" : "GMAIL OAUTH"} · ${status.mail.account ?? ""}`
                  : "NOT CONNECTED"}
              </div>
            </div>
            <Link href="/inbox" className="text-[13px] font-semibold text-teal">
              {status?.mail.connected ? "manage →" : "connect →"}
            </Link>
          </div>
          <div className="h-px" style={{ background: "var(--hairline)" }} />

          {/* Chief Connect: the optional hub. Falls back to the DIY note. */}
          {connect?.configured ? (
            <div className="flex flex-col gap-2.5">
              <div className="font-mono text-[10px] tracking-[0.1em] text-teal">
                CHIEF CONNECT
              </div>
              {connect.error && (
                <div className="text-[13px]" style={{ color: "var(--danger)" }}>
                  {connect.error}
                </div>
              )}
              {(connect.accounts ?? []).map((a) => {
                const serverName = `pipedream-${a.app}`;
                const expanded = toolsFor === serverName;
                return (
                  <div key={a.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <Dot ok={a.healthy} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[14.5px] text-ink">{a.app}</div>
                        {a.name && (
                          <div className="truncate font-mono text-[11px] text-ink-3">
                            {a.name}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => void loadTools(serverName)}
                        className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-teal"
                      >
                        {expanded ? "HIDE TOOLS" : "TOOLS"}
                      </button>
                      <button
                        onClick={() => void disconnectAccount(a.id)}
                        className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-3"
                      >
                        DISCONNECT
                      </button>
                    </div>
                    {expanded && (
                      <div
                        className="flex flex-col gap-2 rounded-control border p-3"
                        style={{ borderColor: "var(--hairline)" }}
                      >
                        {tools === null && !toolsError && (
                          <div className="text-[13px] text-ink-3">Listing tools…</div>
                        )}
                        {toolsError && (
                          <div className="text-[13px]" style={{ color: "var(--danger)" }}>
                            {toolsError}
                          </div>
                        )}
                        {tools?.map((t) => (
                          <div key={t.name} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-[12px] text-ink">
                                {t.name}
                              </div>
                              <div className="truncate text-[11.5px] text-ink-3">
                                {t.readOnly ? "read" : "write — always asks"}
                              </div>
                            </div>
                            {(t.readOnly
                              ? (["auto", "ask", "off"] as const)
                              : (["ask", "off"] as const)
                            ).map((m) => (
                              <button
                                key={m}
                                onClick={() =>
                                  void setToolMode(`pipedream-${a.app}`, t.name, m)
                                }
                                className="rounded-chip border px-2 py-1 font-mono text-[10px] tracking-[0.06em]"
                                style={
                                  t.mode === m
                                    ? {
                                        background: "var(--teal-fill)",
                                        color: "var(--teal-on-fill)",
                                        borderColor: "transparent",
                                      }
                                    : {
                                        borderColor: "var(--hairline)",
                                        color: "var(--ink-3)",
                                      }
                                }
                              >
                                {m.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        ))}
                        {tools && tools.length === 0 && (
                          <div className="text-[13px] text-ink-3">No tools exposed.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                {(connect.apps ?? [])
                  .filter(
                    (app) => !(connect.accounts ?? []).some((a) => a.app === app),
                  )
                  .map((app) => (
                    <button
                      key={app}
                      onClick={() => void openConnectLink(app)}
                      className="rounded-control border px-3 py-2 text-[13.5px] text-ink"
                      style={{ borderColor: "var(--teal-border)" }}
                    >
                      Connect {app.replace(/_/g, " ")} →
                    </button>
                  ))}
              </div>
              {/* Find any app by name (Pipedream catalog). */}
              <div className="flex gap-2">
                <input
                  value={appQuery}
                  onChange={(e) => setAppQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void searchApps()}
                  placeholder="Find an app… (asana, notion, slack)"
                  className={inputCls}
                  style={{ borderColor: "var(--hairline)" }}
                />
                <button
                  onClick={() => void searchApps()}
                  disabled={searching || !appQuery.trim()}
                  className="h-[42px] shrink-0 rounded-control border px-3.5 text-[13.5px] text-ink disabled:opacity-40"
                  style={{ borderColor: "var(--teal-border)" }}
                >
                  {searching ? "…" : "Search"}
                </button>
              </div>
              {appResults && (
                <div className="flex flex-col gap-1.5">
                  {appResults.length === 0 && (
                    <div className="text-[13px] text-ink-3">No matching apps.</div>
                  )}
                  {appResults.map((app) => (
                    <button
                      key={app.slug}
                      onClick={() => void enableApp(app.slug)}
                      className="flex items-center gap-2.5 rounded-control border px-3 py-2 text-left"
                      style={{ borderColor: "var(--hairline)" }}
                    >
                      {app.img && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={app.img} alt="" className="h-5 w-5 rounded" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] text-ink">{app.name}</div>
                        {app.description && (
                          <div className="truncate text-[11.5px] text-ink-3">
                            {app.description}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-[13px] font-semibold text-teal">
                        connect →
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                Connections run through your Chief Connect subscription (2-click
                OAuth). Reads marked AUTO run freely; writes always show an
                approval card (ASK) or can be switched OFF — never auto. Every
                connection has a do-it-yourself twin — app password, your own
                OAuth client, or a direct MCP server below — so you can eject any
                time.
              </p>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-2">
              Remote MCP connectors (calendar, tickets, …) are configured in the
              <span className="font-mono text-[12px]"> Connectors — MCP servers </span>
              setting below — or set the{" "}
              <span className="font-mono text-[12px]">Chief Connect</span> URL +
              key for 2-click connections. Reads run freely; anything that writes
              becomes an approval card.
            </p>
          )}
        </div>
      </Section>

      {/* Chief settings */}
      <Section label="CHIEF SETTINGS">
        <div className={card} style={cardStyle}>
          {defs.map((d) => (
            <div key={d.key} className="flex flex-col gap-1.5">
              <div className="text-[14px] font-medium text-ink">{d.label}</div>
              <div className="text-[12.5px] leading-snug text-ink-3">
                {d.description}
              </div>
              {d.singleLine ? (
                <input
                  value={settings[d.key] ?? ""}
                  placeholder={d.placeholder}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [d.key]: e.target.value }))
                  }
                  className={inputCls}
                  style={{ borderColor: "var(--hairline)" }}
                />
              ) : (
                <textarea
                  value={settings[d.key] ?? ""}
                  placeholder={d.placeholder}
                  rows={d.rows ?? 3}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [d.key]: e.target.value }))
                  }
                  className={`${inputCls} resize-y font-mono text-[12.5px]`}
                  style={{ borderColor: "var(--hairline)" }}
                />
              )}
            </div>
          ))}
          <button
            onClick={() => void saveSettings()}
            disabled={saving}
            className="mt-1 flex h-11 items-center justify-center rounded-control text-[14.5px] font-semibold disabled:opacity-50"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            {saving ? "Saving…" : savedFlash ? "Saved" : "Save settings"}
          </button>
        </div>
      </Section>

      {/* Standing instructions */}
      <Section label={`STANDING INSTRUCTIONS · ${instructions.length}`}>
        <div className={card} style={cardStyle}>
          {instructions.length === 0 && (
            <p className="text-[13.5px] text-ink-3">
              Durable rules Chief applies to every conversation. None yet.
            </p>
          )}
          {instructions.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-[14.5px] text-ink">{doc.title}</div>
              <button
                onClick={() => void deleteDoc(doc.id)}
                className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-3"
              >
                REMOVE
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addInstruction()}
              placeholder="Add a rule, e.g. Always draft replies under 100 words"
              className={inputCls}
              style={{ borderColor: "var(--hairline)" }}
            />
            <button
              onClick={() => void addInstruction()}
              disabled={!newRule.trim()}
              className="h-[42px] shrink-0 rounded-control px-3.5 text-[14px] font-semibold disabled:opacity-40"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              Add
            </button>
          </div>
        </div>
      </Section>

      {/* Memory */}
      <Section label={`MEMORY · ${status?.counts.memory ?? 0}`}>
        <div className={card} style={cardStyle}>
          {memory.length === 0 && (
            <p className="text-[13.5px] text-ink-3">
              Durable facts Chief has saved (with your approval). None yet — they&apos;ll
              accumulate as you work.
            </p>
          )}
          {memory.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1 truncate text-[14.5px] text-ink">
                {doc.title}
              </div>
              <div className="shrink-0 font-mono text-[10px] text-ink-3">
                {doc.updated_at.slice(0, 10)}
              </div>
              <button
                onClick={() => void deleteDoc(doc.id)}
                className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-3"
              >
                REMOVE
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Diagnostics */}
      <Section label="DIAGNOSTICS">
        <div className={card} style={cardStyle}>
          {status ? (
            <>
              <div className="flex items-center gap-3">
                <Dot ok={status.env.anthropic} />
                <span className="flex-1 text-[14px] text-ink">ANTHROPIC_API_KEY</span>
                <span className="font-mono text-[11px] text-ink-3">
                  {status.env.anthropic ? "SET" : "MISSING — Chief can't run"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Dot ok={status.env.voyage} />
                <span className="flex-1 text-[14px] text-ink">VOYAGE_API_KEY</span>
                <span className="font-mono text-[11px] text-ink-3">
                  {status.env.voyage ? "SET" : "OPTIONAL — memory search is text-only"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Dot ok={status.env.googleOauth} />
                <span className="flex-1 text-[14px] text-ink">GOOGLE_CLIENT_ID/SECRET</span>
                <span className="font-mono text-[11px] text-ink-3">
                  {status.env.googleOauth ? "SET" : "OPTIONAL — app password works"}
                </span>
              </div>
            </>
          ) : (
            <p className="text-[13.5px] text-ink-3">Loading…</p>
          )}
        </div>
      </Section>

      {/* Account */}
      <Section label="ACCOUNT">
        <div className={card} style={cardStyle}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] text-ink">Signed in</div>
              <div className="truncate font-mono text-[11px] text-ink-3">
                {status?.account ?? "…"}
              </div>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-control border px-3.5 py-2 text-[13.5px] text-ink-2"
                style={{ borderColor: "var(--hairline)" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </Section>
    </div>
  );
}
