"use client";

// Config — the app's control room, in the established design vocabulary
// (mono section labels, surface cards, teal accents; no spec screen exists
// for this one). Sections: setup checklist (until complete), connections,
// Chief settings (SETTING_DEFS rendered automatically), standing
// instructions, memory, diagnostics, account.

import { useCallback, useEffect, useRef, useState } from "react";
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
  ai?: { provider: string; ready: boolean };
  updates?: {
    provider: string | null;
    repoOwner: string | null;
    repoSlug: string | null;
    enableUrl: string | null;
    repoUrl: string | null;
    settingsUrl: string | null;
    runWorkflowUrl: string | null;
    createPrUrl: string | null;
    reviewUrl: string | null;
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

type Model = { id: string; name: string };

// Searchable model picker: a free-text input backed by a type-to-filter
// dropdown of the models the configured provider actually serves (fetched from
// /api/models). Stays free-text on purpose — gateway ids change constantly and
// a brand-new model should be enterable by hand the moment it ships, so the
// list is a convenience, never a constraint.
function ModelCombobox({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [models, setModels] = useState<Model[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Lazy-load the catalog the first time the field is opened.
  const ensureLoaded = useCallback(async () => {
    if (models !== null || loading) return;
    setLoading(true);
    try {
      const body = (await fetch("/api/models")
        .then((r) => r.json())
        .catch(() => null)) as { models?: Model[] } | null;
      setModels(body?.models ?? []);
    } finally {
      setLoading(false);
    }
  }, [models, loading]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const q = value.trim().toLowerCase();
  const matches = (models ?? []).filter(
    (m) =>
      !q ||
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q),
  );

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          setOpen(true);
          void ensureLoaded();
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        className={inputCls}
        style={{ borderColor: "var(--hairline)" }}
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-64 overflow-y-auto rounded-control border py-1 shadow-lg"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          {loading && (
            <div className="px-3 py-2 text-[13px] text-ink-3">Loading models…</div>
          )}
          {!loading && models !== null && models.length === 0 && (
            <div className="px-3 py-2 text-[12.5px] leading-snug text-ink-3">
              No catalog available — type the model id by hand.
            </div>
          )}
          {!loading && matches.length === 0 && (models?.length ?? 0) > 0 && (
            <div className="px-3 py-2 text-[13px] text-ink-3">
              No match — press Save to use “{value}” as typed.
            </div>
          )}
          {matches.map((m) => {
            const selected = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--teal-fill)]"
                style={selected ? { background: "var(--teal-fill)" } : undefined}
              >
                <span className="font-mono text-[12.5px] text-ink">{m.id}</span>
                {m.name && m.name !== m.id && (
                  <span className="text-[11.5px] text-ink-3">{m.name}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The config surface is split into a Setup landing + one page per concern so
// each screen stays short and scannable. A single ConfigClient renders the
// right sections for the active page (routes pass `section`); the shared
// fetches run once per page load regardless.
export type ConfigSection =
  | "home"
  | "ai"
  | "connections"
  | "chief"
  | "memory";

const CONFIG_PAGES: { slug: ConfigSection; href: string; label: string }[] = [
  { slug: "home", href: "/config", label: "Setup" },
  { slug: "ai", href: "/config/ai", label: "AI & Usage" },
  { slug: "connections", href: "/config/connections", label: "Connections" },
  { slug: "chief", href: "/config/chief", label: "Chief" },
  { slug: "memory", href: "/config/memory", label: "Memory" },
];

// Drill-in back link (ChatGPT-style): sub-pages return to the settings menu.
function ConfigBackLink() {
  return (
    <Link
      href="/config"
      className="-ml-1 flex items-center gap-1 self-start py-1 text-[15px] text-ink-2"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Settings
    </Link>
  );
}

export default function ConfigClient({
  section = "home",
}: {
  section?: ConfigSection;
}) {
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
  const [upd, setUpd] = useState<{
    current: string;
    latest: string | null;
    behind: boolean;
    releaseUrl: string;
    repoPublic?: boolean | null;
  } | null>(null);
  const [usage, setUsage] = useState<{
    available: boolean;
    balance?: string | number | null;
    totalUsed?: string | number | null;
    reason?: string;
  } | null>(null);
  const updatesEnabled = settings["updates.enabled"] === "on";

  const refresh = useCallback(async () => {
    const [s, st, ins, mem, con, up, us] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()).catch(() => null),
      fetch("/api/config/status").then((r) => r.json()).catch(() => null),
      fetch("/api/kb?kind=instruction").then((r) => r.json()).catch(() => null),
      fetch("/api/kb?kind=fact").then((r) => r.json()).catch(() => null),
      fetch("/api/connect").then((r) => r.json()).catch(() => null),
      fetch("/api/updates/status").then((r) => r.json()).catch(() => null),
      fetch("/api/usage").then((r) => r.json()).catch(() => null),
    ]);
    if (s) {
      setDefs(s.defs ?? []);
      setSettings(s.settings ?? {});
    }
    if (st) setStatus(st as Status);
    if (ins) setInstructions((ins.documents ?? []) as KbDoc[]);
    if (mem) setMemory(((mem.documents ?? []) as KbDoc[]).slice(0, 20));
    if (con) setConnect(con as ConnectStatus);
    if (up) setUpd(up);
    if (us) setUsage(us);
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

  // --- Proactive triggers ("Notify me when…") -------------------------------
  const [triggersFor, setTriggersFor] = useState<string | null>(null);
  const [triggerData, setTriggerData] = useState<{
    components: { id: string; name: string; description?: string }[];
    deployed: { id: string; componentId: string | null; name: string | null }[];
  } | null>(null);
  const [triggerBusy, setTriggerBusy] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const loadTriggers = async (app: string) => {
    if (triggersFor === app) {
      setTriggersFor(null);
      setTriggerData(null);
      return;
    }
    setTriggersFor(app);
    setTriggerData(null);
    setTriggerError(null);
    const res = await fetch(`/api/triggers?app=${encodeURIComponent(app)}`).catch(
      () => null,
    );
    const body = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      components?: { id: string; name: string; description?: string }[];
      deployed?: { id: string; componentId: string | null; name: string | null }[];
    };
    setTriggerData({
      components: body.components ?? [],
      deployed: body.deployed ?? [],
    });
  };

  const deployTrigger = async (
    app: string,
    componentId: string,
    name: string,
  ) => {
    setTriggerBusy(componentId);
    setTriggerError(null);
    // Optimistic: show ON immediately with a temporary id; the deploy
    // round-trip (Pipedream) can take several seconds, and we don't want the
    // button to sit on a busy dash until a manual refresh.
    const tempId = `pending:${componentId}`;
    setTriggerData((prev) =>
      prev
        ? { ...prev, deployed: [...prev.deployed, { id: tempId, componentId, name }] }
        : prev,
    );
    const res = await fetch("/api/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app, componentId, name }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    setTriggerBusy(null);
    if (!res || !res.ok || body.ok === false) {
      // Revert the optimistic entry and surface why.
      setTriggerData((prev) =>
        prev
          ? { ...prev, deployed: prev.deployed.filter((d) => d.id !== tempId) }
          : prev,
      );
      setTriggerError(body.error || "Couldn't turn on this notification.");
      return;
    }
    await loadTriggersFresh(app);
  };

  const removeTrigger = async (app: string, id: string) => {
    const removed = triggerData?.deployed.find((d) => d.id === id) ?? null;
    setTriggerBusy(id);
    setTriggerError(null);
    // Optimistic: drop it now so the button flips to OFF instantly.
    setTriggerData((prev) =>
      prev ? { ...prev, deployed: prev.deployed.filter((d) => d.id !== id) } : prev,
    );
    const res = await fetch(`/api/triggers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    setTriggerBusy(null);
    if (!res || !res.ok || body.ok === false) {
      // Put it back and surface why.
      setTriggerData((prev) =>
        prev && removed && !prev.deployed.some((d) => d.id === removed.id)
          ? { ...prev, deployed: [...prev.deployed, removed] }
          : prev,
      );
      setTriggerError(body.error || "Couldn't turn off this notification.");
      return;
    }
    await loadTriggersFresh(app);
  };

  const loadTriggersFresh = async (app: string) => {
    const res = await fetch(`/api/triggers?app=${encodeURIComponent(app)}`).catch(
      () => null,
    );
    // Never clobber optimistic state on a failed/again-in-flight refetch.
    if (!res || !res.ok) return;
    const body = (await res.json().catch(() => null)) as {
      components?: { id: string; name: string; description?: string }[];
      deployed?: { id: string; componentId: string | null; name: string | null }[];
    } | null;
    if (!body) return;
    setTriggerData({
      components: body.components ?? [],
      deployed: body.deployed ?? [],
    });
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

  // Optimistic, isolated write — fired the moment the user opens the GitHub
  // "commit the workflow" link, independent of the batched Chief settings
  // save so it never gets tangled up with unrelated pending edits.
  const markUpdatesEnabled = async () => {
    setSettings((s) => ({ ...s, "updates.enabled": "on" }));
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { "updates.enabled": "on" } }),
    }).catch(() => {});
  };

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
        {
          ok: status.ai?.ready ?? status.env.anthropic,
          label: status.ai
            ? `AI ready (${status.ai.provider})`
            : "AI ready",
        },
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
      {section === "home" ? (
        <h1 className="pt-1 text-[26px] font-semibold text-ink">Settings</h1>
      ) : (
        <ConfigBackLink />
      )}

      {/* Setup: the on-demand concierge, plus the checklist until it's done. */}
      {section === "home" && (
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
      )}

      {/* Home landing: readable, tappable links into each config page. */}
      {section === "home" && (
        <div className="flex flex-col gap-2">
          {CONFIG_PAGES.filter((p) => p.slug !== "home").map((p) => (
            <Link
              key={p.slug}
              href={p.href}
              className="flex items-center justify-between rounded-card border px-4 py-4"
              style={cardStyle}
            >
              <span className="text-[16.5px] text-ink">{p.label}</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="var(--ink-3)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* Connections */}
      {section === "connections" && (
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
                        TOOLS {expanded ? "▴" : "▾"}
                      </button>
                      <button
                        onClick={() => void loadTriggers(a.app)}
                        className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-teal"
                      >
                        NOTIFY {triggersFor === a.app ? "▴" : "▾"}
                      </button>
                      <button
                        onClick={() => void disconnectAccount(a.id)}
                        className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-3"
                      >
                        DISCONNECT
                      </button>
                    </div>
                    {triggersFor === a.app && (
                      <div
                        className="flex flex-col gap-2 rounded-control border p-3"
                        style={{ borderColor: "var(--hairline)" }}
                      >
                        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
                          NOTIFY ME WHEN…
                        </div>
                        {triggerError && (
                          <div
                            className="text-[12px]"
                            style={{ color: "var(--copper, #b4530e)" }}
                          >
                            {triggerError}
                          </div>
                        )}
                        {triggerData === null && (
                          <div className="text-[13px] text-ink-3">Loading…</div>
                        )}
                        {triggerData?.components.length === 0 && (
                          <div className="text-[13px] text-ink-3">
                            No event triggers for this app.
                          </div>
                        )}
                        {triggerData?.components.map((c) => {
                          const on = triggerData.deployed.find(
                            (d) => d.componentId === c.id,
                          );
                          return (
                            <div key={c.id} className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] text-ink">
                                  {c.name}
                                </div>
                                {c.description && (
                                  <div className="truncate text-[11.5px] text-ink-3">
                                    {c.description}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() =>
                                  on
                                    ? void removeTrigger(a.app, on.id)
                                    : void deployTrigger(a.app, c.id, c.name)
                                }
                                disabled={triggerBusy === c.id || triggerBusy === on?.id}
                                className="shrink-0 rounded-chip border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] disabled:opacity-50"
                                style={
                                  on
                                    ? {
                                        background: "var(--teal-fill)",
                                        color: "var(--teal-on-fill)",
                                        borderColor: "transparent",
                                      }
                                    : { borderColor: "var(--hairline)", color: "var(--ink-3)" }
                                }
                              >
                                {on ? "ON" : "OFF"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
      )}

      {/* Chief settings */}
      {section === "chief" && (
      <Section label="CHIEF SETTINGS">
        <div className={card} style={cardStyle}>
          {defs
            .filter((d) => d.key !== "updates.enabled")
            .map((d) => (
            <div key={d.key} className="flex flex-col gap-1.5">
              <div className="text-[14px] font-medium text-ink">{d.label}</div>
              <div className="text-[12.5px] leading-snug text-ink-3">
                {d.description}
              </div>
              {d.key === "chief.model" ? (
                <ModelCombobox
                  value={settings[d.key] ?? ""}
                  placeholder={d.placeholder}
                  onChange={(v) =>
                    setSettings((s) => ({ ...s, [d.key]: v }))
                  }
                />
              ) : d.singleLine ? (
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
      )}

      {/* Memory & standing instructions */}
      {section === "memory" && (
      <>
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
      </>
      )}

      {/* AI, keys & updates */}
      {section === "ai" && (
      <>
      <Section label="AI USAGE">
        <div className={card} style={cardStyle}>
          {usage?.available ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-ink-2">Credit balance</span>
                <span className="font-mono text-[14px] text-ink">
                  {usage.balance != null
                    ? `$${Number(usage.balance).toFixed(2)}`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-ink-2">Spent to date</span>
                <span className="font-mono text-[14px] text-ink">
                  {usage.totalUsed != null
                    ? `$${Number(usage.totalUsed).toFixed(2)}`
                    : "—"}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-3">
                Vercel AI Gateway credits, on your own Vercel account. Top up or
                manage in the Vercel dashboard.
              </p>
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-2">
              {usage?.reason === "not-gateway"
                ? "Direct Anthropic mode — usage and billing live in your Anthropic console."
                : usage?.reason === "no-credential"
                  ? "No gateway credential detected yet."
                  : "Usage unavailable right now."}
            </p>
          )}
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

      {/* Software updates */}
      <Section label="SOFTWARE UPDATES">
        <div className={card} style={cardStyle}>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Chief improves over time. Updates arrive as pull requests in{" "}
            <span className="text-ink">your own</span> repo — you review and
            merge; merging deploys the new version. Nothing changes without your
            approval.{" "}
            <a
              href="/changelog"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal underline"
            >
              See what&apos;s changed
            </a>
            .
          </p>

          {/* Make-repo-public safety net: on the free Vercel plan a PRIVATE
              repo blocks the updater's merge commits from deploying (the wall
              Jim hit). A Chief clone holds no secrets, so public is safe — and
              it's the one thing that makes merges deploy automatically. Only
              shown when we positively detected the repo is private. */}
          {upd?.repoPublic === false && status?.updates?.settingsUrl ? (
            <div
              className="flex flex-col gap-2 rounded-control border p-3"
              style={{ borderColor: "var(--copper-border, var(--hairline))", background: "var(--copper-dim, var(--raised))" }}
            >
              <div className="flex items-center gap-2">
                <Dot ok={false} />
                <span className="text-[14px] font-medium text-ink">
                  Make your repo public to receive updates
                </span>
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                On the free Vercel plan a <span className="text-ink">private</span>{" "}
                repo won&apos;t deploy an update after you merge it. Your repo is
                just a copy of the public Chief code and holds{" "}
                <span className="text-ink">no secrets</span> — your keys and data
                live in your Supabase, never in the repo — so making it public is
                safe, and it makes merges deploy automatically.
              </p>
              <a
                href={status.updates.settingsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-control px-4 text-[14px] font-medium"
                style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
              >
                Open repo settings →
              </a>
              <span className="text-[11.5px] leading-relaxed text-ink-3">
                In Settings, scroll to <span className="text-ink-2">Danger
                Zone</span> → <span className="text-ink-2">Change repository
                visibility</span> → <span className="text-ink-2">Public</span>.
              </span>
            </div>
          ) : null}

          {upd &&
            (upd.behind ? (
              <div
                className="flex flex-col gap-2 rounded-control border p-3"
                style={{ borderColor: "var(--copper-border, var(--hairline))", background: "var(--copper-dim, var(--raised))" }}
              >
                <div className="flex items-center gap-2">
                  <Dot ok={false} />
                  <span className="text-[14px] font-medium text-ink">
                    Update available — v{upd.latest}
                  </span>
                </div>
                <span className="text-[12.5px] text-ink-2">
                  You&apos;re on v{upd.current}.{" "}
                  <a
                    href="/changelog"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal underline"
                  >
                    What&apos;s new
                  </a>
                </span>
                {updatesEnabled && status?.updates?.createPrUrl ? (
                  <>
                    <a
                      href={status.updates.createPrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-control px-4 text-[14px] font-medium"
                      style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                    >
                      Review &amp; merge →
                    </a>
                    <span className="text-[11.5px] leading-relaxed text-ink-3">
                      Opens the update in your repo — review the diff, tap{" "}
                      <span className="text-ink-2">Create pull request</span>{" "}
                      (or open the one already waiting), then merge; merging
                      deploys it. Nothing to review yet?{" "}
                      {status.updates.runWorkflowUrl ? (
                        <a
                          href={status.updates.runWorkflowUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal underline"
                        >
                          Prepare it first
                        </a>
                      ) : (
                        "run the updater"
                      )}{" "}
                      (tap <span className="text-ink-2">Run workflow</span>).
                    </span>
                  </>
                ) : (
                  <span className="text-[11.5px] leading-relaxed text-ink-3">
                    Turn on auto-updates below first — a one-time step so GitHub
                    can open this update as a pull request.
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Dot ok={true} />
                <span className="text-[13px] text-ink-2">
                  Up to date{upd.current ? ` (v${upd.current})` : ""}.
                </span>
              </div>
            ))}

          {status?.updates?.enableUrl ? (
            updatesEnabled ? (
              <>
                <div className="flex items-center gap-2">
                  <Dot ok={true} />
                  <span className="text-[13px] text-ink-2">
                    Auto-updates enabled for{" "}
                    <span className="font-mono text-[12px] text-ink">
                      {status.updates.repoOwner}/{status.updates.repoSlug}
                    </span>
                    .{" "}
                    <a
                      href={status.updates.enableUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal underline"
                    >
                      Re-commit the workflow
                    </a>
                  </span>
                </div>
                <p className="text-[11.5px] leading-relaxed text-ink-3">
                  The weekly check pauses if your repo sees no activity for 60
                  days (a GitHub rule). Chief still spots new versions on its
                  own; if a check hasn&apos;t run,{" "}
                  {status.updates.runWorkflowUrl ? (
                    <a
                      href={status.updates.runWorkflowUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal underline"
                    >
                      run it manually
                    </a>
                  ) : (
                    "run it manually"
                  )}{" "}
                  any time.
                </p>
              </>
            ) : (
              <>
                <p className="text-[13.5px] leading-relaxed text-ink-2">
                  Turn on auto-updates once: this commits the updater workflow
                  into{" "}
                  <span className="font-mono text-[12px] text-ink">
                    {status.updates.repoOwner}/{status.updates.repoSlug}
                  </span>{" "}
                  as you. (The one-click deploy can&apos;t include it — GitHub
                  won&apos;t let an automated deploy add workflow files — so this
                  one step is manual.)
                </p>
                <a
                  href={status.updates.enableUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={markUpdatesEnabled}
                  className="inline-flex h-11 items-center justify-center rounded-control px-4 text-[15px] font-medium"
                  style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                >
                  Enable auto-updates →
                </a>
                <p className="text-[12px] leading-relaxed text-ink-3">
                  On the GitHub page, scroll down and tap{" "}
                  <span className="text-ink-2">Commit changes</span>. Then, one
                  time, under Settings → Actions → General → Workflow
                  permissions, check{" "}
                  <span className="text-ink-2">
                    Allow GitHub Actions to create and approve pull requests
                  </span>
                  . This one can&apos;t be granted by the workflow file itself —
                  skip it and the updater&apos;s PR step fails.
                </p>
              </>
            )
          ) : (
            <p className="text-[12px] leading-relaxed text-ink-3">
              Auto-update setup is available on a Vercel + GitHub deployment.
              To update manually, merge upstream{" "}
              <span className="font-mono">jim-homejab/ai-cockpit</span> into
              your repo.
            </p>
          )}
        </div>
      </Section>
      </>
      )}
    </div>
  );
}
