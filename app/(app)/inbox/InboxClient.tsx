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
  configured: boolean;
  connected: boolean;
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
  const { setOpen, send, streaming } = useChief();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [chiefRead, setChiefRead] = useState<string | null>(null);
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
      setData({ configured: true, connected: true, error: "Couldn't reach the inbox." });
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

  const askChief = useCallback(() => setOpen(true), [setOpen]);
  const draftReply = useCallback(() => {
    setOpen(true);
    if (!streaming) {
      void send(
        "Draft a reply to the email I'm looking at, in my voice, then propose sending it.",
      );
    }
  }, [setOpen, send, streaming]);

  // --- Render states ---------------------------------------------------------

  if (loading && !data) {
    return <div className="pt-6 text-[14px] text-ink-3">Checking the inbox…</div>;
  }

  if (data && !data.configured) {
    return (
      <SetupCard title="Gmail isn't configured yet">
        Add <Mono>GOOGLE_CLIENT_ID</Mono> and <Mono>GOOGLE_CLIENT_SECRET</Mono> to your
        deployment&apos;s environment variables (your own Google Cloud OAuth client — see
        the README&apos;s Gmail section), then reload.
      </SetupCard>
    );
  }

  if (data && !data.connected) {
    return (
      <SetupCard title="Connect your Gmail">
        Chief reads your inbox through Google&apos;s official Gmail MCP server with a grant
        you approve — your tokens live only in your own database.
        <a
          href="/api/google/connect"
          className="mt-4 flex h-12 items-center justify-center rounded-control text-[15px] font-semibold"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          Connect Gmail
        </a>
      </SetupCard>
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
    <div className="flex h-[calc(100dvh-218px)] flex-col gap-4">
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

      {/* Header: title + queue pill */}
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-[22px] font-semibold text-ink">Inbox</h1>
        <div
          className="rounded-full border px-2.5 py-[5px] font-mono text-[11px] tracking-[0.08em] text-ink-3"
          style={{ borderColor: "var(--hairline)" }}
        >
          {queue > 1 ? `${queue - 1} MORE` : "LAST ONE"}
        </div>
      </div>

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

          {/* Thumb-zone actions */}
          <div className="flex flex-col gap-2.5 pb-1">
            <button
              onClick={askChief}
              className="flex h-[52px] items-center justify-center gap-2 rounded-card text-[16px] font-semibold"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              <span className="font-serif text-[17px] italic">C</span>
              Ask Chief about this
            </button>
            <div className="flex gap-2.5">
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
          </div>
        </>
      )}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[13px] text-ink">{children}</span>;
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
