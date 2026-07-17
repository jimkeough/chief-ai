"use client";

// The Inbox — triage, one email at a time, per the design spec: header with
// queue pill, one email card (sender, subject, body, Chief's one-line serif
// read), and thumb-zone actions (Ask Chief / Archive / Reply). Archive
// executes on tap (the tap IS the approval — it still runs through the
// executor's gate) and hands back a receipt with Undo. Reply opens Chief,
// which proposes the send as a red-tier slide-to-send card.

import { useCallback, useEffect, useRef, useState } from "react";
import { useChief } from "@/app/components/ChiefProvider";
import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import type { UndoDescriptor } from "@/lib/undo";

type InboxEmail = {
  threadId: string;
  messageId: string | null;
  from: string;
  to: string[];
  subject: string;
  date: string | null;
  snippet: string;
  body: string;
  messageCount: number;
};

type InboxResponse = {
  connected: boolean;
  /** Whether the deployment has a Google OAuth client (enables that path). */
  oauthConfigured?: boolean;
  provider?: "imap" | "gmail-mcp";
  account?: string | null;
  email?: InboxEmail | null;
  queueCount?: number;
  contact?: { id: string; name: string } | null;
  error?: string;
};

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  return from.split("@")[0] ?? from;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
  if (sameDay) return `TODAY ${time}`;
  return `${d
    .toLocaleDateString(undefined, { month: "short", day: "numeric" })
    .toUpperCase()} ${time}`;
}

export default function InboxClient() {
  const { runIntent } = useChief();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [chiefRead, setChiefRead] = useState<string | null>(null);
  // Account plumbing (provider + disconnect) is hidden by default so the email
  // is the whole view; revealed on demand from the header's ⋯ control.
  const [showAcct, setShowAcct] = useState(false);
  const [receipt, setReceipt] = useState<{
    text: string;
    undo: UndoDescriptor | null;
    busy: boolean;
  } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const readFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inbox");
      const body = (await res.json()) as InboxResponse;
      setData(body);
    } catch {
      setData({ connected: true, error: "Couldn't reach the inbox." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Chief's one-line read, fetched once per message.
  const email = data?.email ?? null;
  useEffect(() => {
    if (!email?.messageId || readFor.current === email.messageId) return;
    readFor.current = email.messageId;
    setChiefRead(null);
    void fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: email.messageId,
        from: email.from,
        subject: email.subject,
        body: email.body,
      }),
    })
      .then((r) => r.json())
      .then((r: { ok?: boolean; read?: string }) => {
        if (r.ok && r.read) setChiefRead(r.read);
      })
      .catch(() => {});
  }, [email]);

  const archive = useCallback(async () => {
    if (!email || archiving) return;
    setArchiving(true);
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "archive_email",
          args: { thread_id: email.threadId, subject: email.subject },
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        result?: string;
        error?: string;
        undo?: UndoDescriptor;
      };
      if (res.ok && body.ok) {
        setReceipt({ text: body.result ?? "Archived.", undo: body.undo ?? null, busy: false });
        await refresh();
      } else {
        setReceipt({ text: body.error ?? "Archive failed.", undo: null, busy: false });
      }
    } finally {
      setArchiving(false);
    }
  }, [email, archiving, refresh]);

  const undoArchive = useCallback(async () => {
    if (!receipt?.undo || receipt.busy) return;
    setReceipt({ ...receipt, busy: true });
    const res = await fetch("/api/actions/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ undo: receipt.undo }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { ok?: boolean; result?: string };
    if (res?.ok && body.ok) {
      setReceipt(null);
      await refresh();
    } else {
      setReceipt({ text: "Undo failed.", undo: receipt.undo, busy: false });
    }
  }, [receipt, refresh]);

  const disconnect = useCallback(async () => {
    const url =
      data?.provider === "imap" ? "/api/mail/disconnect" : "/api/google/disconnect";
    await fetch(url, { method: "POST" }).catch(() => {});
    await refresh();
  }, [data?.provider, refresh]);

  const draftReply = useCallback(() => {
    void runIntent({
      id: "inbox.draft_reply",
      threadId: email?.threadId,
    });
  }, [email?.threadId, runIntent]);

  // --- Render states ---------------------------------------------------------

  if (loading && !data) {
    return <div className="pt-6 text-[14px] text-ink-3">Checking the inbox…</div>;
  }

  if (data && !data.connected) {
    return (
      <ConnectMail
        oauthConfigured={data.oauthConfigured === true}
        onConnected={() => void refresh()}
      />
    );
  }

  if (data?.error) {
    return (
      <SetupCard title="Inbox unavailable">
        {data.error}
        <button
          onClick={() => void refresh()}
          className="mt-4 flex h-11 items-center justify-center rounded-control border text-[14px] text-ink-2"
          style={{ borderColor: "var(--hairline)" }}
        >
          Try again
        </button>
      </SetupCard>
    );
  }

  const queue = data?.queueCount ?? 0;
  const name = email ? senderName(email.from) : "";

  return (
    <div className="flex min-h-[calc(100dvh-218px)] flex-col gap-4">
      {email && (
            <ChiefPageSnapshot
              route="/inbox"
              label={`Email — ${email.subject}`}
              untrusted
              state={{
                thread_id: email.threadId,
                message_id: email.messageId,
                from: email.from,
                to: email.to,
                subject: email.subject,
                date: email.date,
                queue_count: queue,
                contact: data?.contact ?? null,
                body: email.body.slice(0, 4000),
              }}
            />
          )}

          {/* Header: title + queue pill + (tucked-away) account control */}
          <div className="flex items-center justify-between pt-2">
            <h1 className="text-[22px] font-semibold text-ink">Email</h1>
        <div className="flex items-center gap-2">
          <div
            className="rounded-full border px-2.5 py-[5px] font-mono text-[11px] tracking-[0.08em] text-ink-3"
            style={{ borderColor: "var(--hairline)" }}
          >
            {queue > 1 ? `${queue - 1} MORE` : "LAST ONE"}
          </div>
          {data?.account && (
            <button
              aria-label="Email account"
              aria-expanded={showAcct}
              onClick={() => setShowAcct((s) => !s)}
              className="flex h-8 w-8 items-center justify-center rounded-full border text-ink-3"
              style={{ borderColor: "var(--hairline)" }}
            >
              <svg width="15" height="4" viewBox="0 0 15 4" fill="currentColor" aria-hidden="true">
                <circle cx="2" cy="2" r="1.6" />
                <circle cx="7.5" cy="2" r="1.6" />
                <circle cx="13" cy="2" r="1.6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Account strip — only when the user taps ⋯; keeps the reading view clean */}
      {showAcct && data?.account && (
        <div
          className="flex items-center justify-between rounded-control border px-3 py-2 font-mono text-[11px] tracking-[0.06em] text-ink-3"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <span className="truncate">
            {data.provider === "imap" ? "IMAP" : "GMAIL"} · {data.account}
          </span>
          <button
            onClick={() => void disconnect()}
            className="shrink-0 pl-3 underline underline-offset-2"
          >
            DISCONNECT
          </button>
        </div>
      )}

      {/* Receipt strip after an archive */}
      {receipt && (
        <div
          className="flex items-center gap-3 rounded-card border px-3.5 py-3"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--ok) 15%, transparent)" }}
            aria-hidden="true"
          >
            <svg width="13" height="11" viewBox="0 0 13 11" fill="none">
              <path
                d="M1.5 5.5l3.5 3.5L11.5 1.5"
                stroke="var(--ok)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1 text-[14px] text-ink">{receipt.text}</div>
          {receipt.undo && (
            <button
              onClick={() => void undoArchive()}
              className="shrink-0 px-2 py-2 font-mono text-[12px] tracking-[0.06em] text-teal"
            >
              {receipt.busy ? "…" : "Undo"}
            </button>
          )}
          <button
            aria-label="Dismiss"
            onClick={() => setReceipt(null)}
            className="shrink-0 px-1 text-ink-3"
          >
            ✕
          </button>
        </div>
      )}

      {!email ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 rounded-card border px-6 py-16"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="chief-voice text-[20px] text-ink">Inbox zero.</div>
          <div className="text-[14px] text-ink-3">Nothing waiting on you here.</div>
        </div>
      ) : (
        <>
          {/* The one email */}
          <div
            className="flex min-h-0 flex-1 flex-col gap-4 rounded-card border p-[18px] pt-5"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-[16px] font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--copper) 16%, transparent)",
                  color: "var(--copper)",
                }}
                aria-hidden="true"
              >
                {initials(name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold text-ink">
                  {data?.contact?.name ?? name}
                </div>
                <div className="font-mono text-[11px] text-ink-3">
                  {dateLabel(email.date)}
                  {email.messageCount > 1 ? ` · ${email.messageCount} MESSAGES` : ""}
                </div>
              </div>
            </div>

            <div className="text-[18px] font-semibold leading-[1.35] text-ink">
              {email.subject}
            </div>
            <div className="h-px" style={{ background: "var(--hairline)" }} />
            <div
              className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[16px] leading-relaxed"
              style={{ color: "var(--ink-2)" }}
            >
              {email.body || email.snippet}
            </div>

            {/* Chief's one-line read */}
            <div
              className="flex items-center gap-2 rounded-control border px-3 py-2.5"
              style={{
                background: "color-mix(in srgb, var(--teal) 8%, transparent)",
                borderColor: "color-mix(in srgb, var(--teal) 18%, transparent)",
              }}
            >
              <div className="chief-voice text-[14.5px] leading-snug text-teal">
                {chiefRead ? `Chief: ${chiefRead}` : "Chief is reading…"}
              </div>
            </div>
          </div>

          {/* Thumb-zone actions. "Ask Chief" lives in the always-docked Chief
              bar just below (it already carries this email as context), so the
              email keeps the room instead of a redundant button. */}
          <div className="flex gap-2.5 pb-1">
            <button
              onClick={() => void archive()}
              disabled={archiving}
              className="h-12 flex-1 rounded-control border text-[16px] font-medium text-ink-2"
              style={{ borderColor: "var(--hairline)" }}
            >
              {archiving ? "Archiving…" : "Archive"}
            </button>
            <button
              onClick={draftReply}
              className="h-12 flex-1 rounded-control border text-[16px] font-medium text-ink"
              style={{ borderColor: "var(--hairline)" }}
            >
              Reply
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Connect screen ---------------------------------------------------------
// The easy path: an app password over IMAP/SMTP (any provider; defaults are
// Gmail's). The scoped path: Google OAuth, shown when the deployment has a
// client configured. Both credentials live only in the user's own database.

const field =
  "h-11 w-full rounded-control border bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-ink-3";

function ConnectMail({
  oauthConfigured,
  onConnected,
}: {
  oauthConfigured: boolean;
  onConnected: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState("imap.gmail.com");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("465");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mail/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          imap_host: imapHost,
          imap_port: Number(imapPort),
          smtp_host: smtpHost,
          smtp_port: Number(smtpPort),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && body.ok) onConnected();
      else setError(body.error ?? "Connection failed.");
    } catch {
      setError("Connection failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <h1 className="text-[22px] font-semibold text-ink">Email</h1>
      <div
        className="flex flex-col gap-3 rounded-card border p-5"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <div className="text-[16px] font-semibold text-ink">Connect your email</div>
        <p className="text-[14px] leading-relaxed text-ink-2">
          Paste an <span className="text-ink">app password</span> — for Gmail: turn on
          2-Step Verification, then create one at{" "}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noreferrer"
            className="text-teal underline underline-offset-2"
          >
            myaccount.google.com/apppasswords
          </a>
          . It grants full mailbox access, is stored only in your own database, and you
          can revoke it there any time.
        </p>
        <input
          type="email"
          autoComplete="email"
          placeholder="you@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
          style={{ borderColor: "var(--hairline)" }}
        />
        <input
          type="password"
          autoComplete="off"
          placeholder="App password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
          style={{ borderColor: "var(--hairline)" }}
        />
        <button
          onClick={() => setAdvanced((a) => !a)}
          className="self-start font-mono text-[11px] tracking-[0.08em] text-ink-3"
        >
          {advanced ? "HIDE" : "NOT GMAIL?"} · SERVER SETTINGS
        </button>
        {advanced && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                placeholder="IMAP host"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                className={`${field} flex-[2]`}
                style={{ borderColor: "var(--hairline)" }}
              />
              <input
                placeholder="993"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                className={`${field} flex-1`}
                style={{ borderColor: "var(--hairline)" }}
              />
            </div>
            <div className="flex gap-2">
              <input
                placeholder="SMTP host"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                className={`${field} flex-[2]`}
                style={{ borderColor: "var(--hairline)" }}
              />
              <input
                placeholder="465"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className={`${field} flex-1`}
                style={{ borderColor: "var(--hairline)" }}
              />
            </div>
          </div>
        )}
        {error && (
          <div className="text-[13px]" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
        <button
          onClick={() => void submit()}
          disabled={busy || !email.trim() || !password.trim()}
          className="flex h-12 items-center justify-center rounded-control text-[15px] font-semibold disabled:opacity-40"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          {busy ? "Checking the connection…" : "Connect"}
        </button>
      </div>

      {oauthConfigured && (
        <div
          className="flex flex-col gap-2 rounded-card border p-5"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="text-[15px] font-semibold text-ink">
            Prefer the scoped route?
          </div>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Google OAuth grants only mail read/compose/send scopes through Google&apos;s
            official Gmail MCP server (requires the Google Cloud setup from the README).
          </p>
          <a
            href="/api/google/connect"
            className="mt-1 flex h-11 items-center justify-center rounded-control border text-[14px] font-medium text-ink"
            style={{ borderColor: "var(--hairline)" }}
          >
            Connect with Google OAuth
          </a>
        </div>
      )}
    </div>
  );
}

function SetupCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <h1 className="text-[22px] font-semibold text-ink">Inbox</h1>
      <div
        className="flex flex-col rounded-card border p-5"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <div className="mb-2 text-[16px] font-semibold text-ink">{title}</div>
        <div className="text-[14.5px] leading-relaxed text-ink-2">{children}</div>
      </div>
    </div>
  );
}
