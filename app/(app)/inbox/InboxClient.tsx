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
  /** Inbox source: Front tag (primary) vs email transport (Gmail/IMAP). */
  const [source, setSource] = useState<"front" | "email">("front");
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
      <div className="flex flex-col gap-5">
        <FrontTagInbox />
        <ConnectMail
          oauthConfigured={data.oauthConfigured === true}
          onConnected={() => void refresh()}
        />
      </div>
    );
  }

  if (data?.error && source === "email") {
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
      <div
        className="flex gap-1 rounded-control border p-1"
        style={{ borderColor: "var(--hairline)" }}
        role="tablist"
        aria-label="Inbox source"
      >
        {(
          [
            ["front", "Front"],
            ["email", "Email"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={source === id}
            onClick={() => setSource(id)}
            className="flex-1 rounded-[10px] px-3 py-2 text-[13px] font-medium"
            style={
              source === id
                ? { background: "var(--ink)", color: "var(--paper)" }
                : { color: "var(--ink-2)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {source === "front" ? (
        <FrontTagInbox />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// --- Front tag inbox --------------------------------------------------------
// First-class Front triage: requires Config front.inbox_zero_tag_id, lists via
// GET /tags/{id}/conversations, click for detail, registers Chief page context
// for "discuss all" / "discuss this one". Email (Gmail/IMAP) and future Outlook
// are separate sources under the same Inbox page — not folded into this list.

type FrontTagResponse =
  | {
      provider: "front-tag";
      connected: true;
      tagId: string;
      tagName: string;
      account: string;
      source: string;
      total?: number;
      threads: Array<{
        id: string;
        subject: string;
        status: string;
        preview: string;
        correspondent: string;
        updatedAt: string | null;
        tags: string[];
        externalUrl: string | null;
      }>;
      nextCursor: string | null;
      hasMore: boolean;
      note?: string;
    }
  | {
      provider: "front-tag";
      connected: true;
      needsTag: true;
      message: string;
    }
  | { provider: "front-tag"; connected: false }
  | { provider: "front-tag"; connected: true; error: string };

type FrontThreadDetail = {
  id: string;
  subject: string;
  status: string;
  preview: string;
  correspondent: string;
  updatedAt: string | null;
  tags: string[];
  externalUrl: string | null;
  body: string;
  assignee: string;
  inboxes: string[];
};

function FrontTagInbox() {
  const [data, setData] = useState<FrontTagResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FrontThreadDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const refresh = useCallback(() => {
    let alive = true;
    void fetch("/api/inbox/front?status=all&limit=100")
      .then((r) => r.json())
      .then((b: FrontTagResponse) => {
        if (alive) setData(b);
      })
      .catch(() => {
        if (alive) setData({ provider: "front-tag", connected: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailBusy(true);
    void fetch(`/api/inbox/front/${encodeURIComponent(selectedId)}`)
      .then((r) => r.json())
      .then((b: { ok?: boolean; thread?: FrontThreadDetail; error?: string }) => {
        if (!alive) return;
        if (b.ok && b.thread) setDetail(b.thread);
        else setDetail(null);
      })
      .catch(() => {
        if (alive) setDetail(null);
      })
      .finally(() => {
        if (alive) setDetailBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  if (!data) {
    return (
      <div className="pt-2 text-[14px] text-ink-3">Loading Front inbox…</div>
    );
  }

  if (!data.connected) return null;

  if ("needsTag" in data && data.needsTag) {
    return (
      <section className="flex flex-col gap-3 pt-2">
        <h1 className="text-[22px] font-semibold text-ink">Inbox</h1>
        <div
          className="flex flex-col gap-2 rounded-card border px-4 py-4"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="text-[16px] font-semibold text-ink">Choose a Front tag</div>
          <p className="text-[14px] leading-relaxed text-ink-2">{data.message}</p>
          <a
            href="/config"
            className="mt-1 inline-flex h-11 items-center justify-center rounded-control border text-[14px] text-ink-2"
            style={{ borderColor: "var(--hairline)" }}
          >
            Open Config
          </a>
        </div>
      </section>
    );
  }

  if ("error" in data && data.error) {
    return (
      <section className="flex flex-col gap-2.5 pt-2">
        <h1 className="text-[22px] font-semibold text-ink">Inbox</h1>
        <div
          className="rounded-control border px-3 py-2.5 text-[13px] text-ink-2"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          {data.error}
        </div>
      </section>
    );
  }

  if (!("threads" in data)) return null;

  const threads = data.threads;
  const countLabel =
    data.total !== undefined ? `${data.total}` : `${threads.length}`;

  if (selectedId) {
    return (
      <section className="flex flex-col gap-3 pt-2">
        <ChiefPageSnapshot
          route="/inbox"
          label={`Front — ${detail?.subject ?? selectedId}`}
          state={{
            provider: "front-tag",
            tag_id: data.tagId,
            tag_name: data.tagName,
            conversation_id: selectedId,
            subject: detail?.subject ?? null,
            status: detail?.status ?? null,
            correspondent: detail?.correspondent ?? null,
            assignee: detail?.assignee ?? null,
            tags: detail?.tags ?? [],
            inboxes: detail?.inboxes ?? [],
            preview: detail?.preview ?? null,
            body: detail?.body?.slice(0, 2000) ?? null,
            external_url: detail?.externalUrl ?? null,
          }}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="text-[14px] text-ink-2 underline underline-offset-2"
          >
            ← All tagged
          </button>
          <h1 className="truncate text-[18px] font-semibold text-ink">
            {detail?.subject ?? "Conversation"}
          </h1>
        </div>
        {detailBusy && !detail ? (
          <div className="text-[14px] text-ink-3">Loading…</div>
        ) : detail ? (
          <article
            className="flex flex-col gap-3 rounded-card border px-4 py-4"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold text-ink">
                {detail.correspondent || "Discussion"}
              </span>
              <span className="font-mono text-[11px] text-ink-3">
                {dateLabel(detail.updatedAt)} · {detail.status.toUpperCase()}
              </span>
            </div>
            {detail.assignee && (
              <div className="text-[13px] text-ink-3">Assignee: {detail.assignee}</div>
            )}
            {detail.inboxes.length === 0 && (
              <div className="font-mono text-[11px] tracking-[0.06em] text-ink-3">
                NO INBOX · DISCUSSION
              </div>
            )}
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">
              {detail.body || detail.preview || "(no preview)"}
            </p>
            {detail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-ink-3"
                    style={{ borderColor: "var(--hairline)" }}
                  >
                    {t.toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            {detail.externalUrl && (
              <a
                href={detail.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-ink-2 underline underline-offset-2"
              >
                Open in Front
              </a>
            )}
          </article>
        ) : (
          <div className="text-[14px] text-ink-3">Couldn&apos;t load this conversation.</div>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 pt-2">
      <ChiefPageSnapshot
        route="/inbox"
        label={`Inbox — Front · ${data.tagName}`}
        state={{
          provider: "front-tag",
          tag_id: data.tagId,
          tag_name: data.tagName,
          account: data.account,
          source: data.source,
          total: data.total ?? threads.length,
          conversations: threads.map((t) => ({
            id: t.id,
            subject: t.subject,
            status: t.status,
            correspondent: t.correspondent,
            preview: t.preview.slice(0, 120),
            updated_at: t.updatedAt,
          })),
        }}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-ink">Inbox</h1>
          <div className="font-mono text-[11px] tracking-[0.06em] text-ink-3">
            FRONT · {data.tagName.toUpperCase()}
          </div>
        </div>
        <div
          className="rounded-full border px-2.5 py-[5px] font-mono text-[11px] tracking-[0.08em] text-ink-3"
          style={{ borderColor: "var(--hairline)" }}
        >
          {countLabel} TAGGED
        </div>
      </div>

      {threads.length === 0 ? (
        <div
          className="rounded-control border px-3 py-2.5 text-[13.5px] text-ink-3"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          No conversations on this tag.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelectedId(c.id)}
                className="flex w-full flex-col gap-1 rounded-card border px-3.5 py-3 text-left"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface)",
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold text-ink">
                    {c.correspondent || c.subject}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">
                    {dateLabel(c.updatedAt)}
                  </span>
                </div>
                {c.correspondent && (
                  <span className="truncate text-[14px] text-ink-2">{c.subject}</span>
                )}
                {c.preview && (
                  <span className="line-clamp-2 text-[13.5px] leading-snug text-ink-3">
                    {c.preview}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className="font-mono text-[10px] tracking-[0.06em] text-ink-3">
                    {c.status.toUpperCase()}
                  </span>
                  {c.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-ink-3"
                      style={{ borderColor: "var(--hairline)" }}
                    >
                      {t.toUpperCase()}
                    </span>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      <h1 className="text-[22px] font-semibold text-ink">Inbox</h1>
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
