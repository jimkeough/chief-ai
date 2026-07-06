"use client";

// Home — the focus view, per the design spec: date line → Chief's narrative
// (serif, one teal-highlighted phrase) → TOP N (deterministic ranking; Chief
// never reorders) → pending proposals → the Waiting-on strip (green = moved,
// gray = quiet, copper = aging).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  useChief,
  SETUP_INTERVIEW_PROMPT,
  type ProposalItem,
} from "@/app/components/ChiefProvider";
import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import ProposalGroup from "@/app/components/ProposalCards";

type TopRow = {
  id: string;
  title: string;
  priority: string | null;
  due_at: string | null;
  project_id: string | null;
  unblocked: boolean;
  effortNote: string | null;
};
type WaitingRow = {
  taskId: string;
  who: string;
  what: string;
  state: "moved" | "quiet" | "aging";
  days: number;
};

type AwayEvent = {
  id: string;
  app: string | null;
  summary: string | null;
  proposal: { key: string; label: string; preview: string; args: Record<string, unknown> } | null;
};
type HomeResponse = {
  narrative: string;
  top: TopRow[];
  waiting: WaitingRow[];
  openCount: number;
};

function dateLine(): string {
  const now = new Date();
  const date = now
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .replace(/,/g, "")
    .toUpperCase();
  const time = now
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
  return `${date} · ${time}`;
}

function dueLabelShort(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "overdue";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// Chief's narrative arrives with ONE **highlighted** phrase — render it teal.
function Narrative({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <div className="font-serif text-[20px] font-medium leading-[1.4] text-ink">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-teal">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

export default function HomeClient({ initial }: { initial: string }) {
  const chief = useChief();
  const [data, setData] = useState<HomeResponse | null>(null);
  const [now, setNow] = useState("");

  useEffect(() => {
    setNow(dateLine());
    void fetch("/api/home")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HomeResponse | null) => d && setData(d))
      .catch(() => {});
    void fetch("/api/events/list")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: AwayEvent[] } | null) => d?.events && setAway(d.events))
      .catch(() => {});
  }, []);

  // Proactive events that arrived while away (Proactive Chief). Each is a
  // one-line summary; some carry a standard-tier proposal to approve in place.
  const [away, setAway] = useState<AwayEvent[]>([]);
  const dropAway = (id: string) => setAway((xs) => xs.filter((e) => e.id !== id));
  const resolveAway = async (
    id: string,
    status: "acted" | "dismissed",
  ) => {
    dropAway(id);
    await fetch("/api/events/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  };
  const approveAway = async (e: AwayEvent) => {
    if (!e.proposal) return;
    dropAway(e.id);
    await fetch("/api/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: e.proposal.key, args: e.proposal.args }),
    }).catch(() => {});
    await fetch("/api/events/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: e.id, status: "acted" }),
    }).catch(() => {});
  };

  // Pending proposals from the shared Chief conversation — approvable right
  // here on Home.
  const pending: ProposalItem[] = useMemo(
    () =>
      chief.messages.flatMap(
        (m) => m.proposals?.filter((p) => p.status !== "undone") ?? [],
      ),
    [chief.messages],
  );
  const pendingCount = pending.filter((p) => p.status === "proposed").length;
  const handlers = {
    onApprove: (uid: string, mergeTargetId?: string) =>
      void chief.approve(uid, mergeTargetId),
    onDismiss: chief.dismiss,
    onRestore: chief.restore,
    onUndo: (uid: string) => void chief.undo(uid),
  };

  return (
    <div className="flex flex-col gap-5 pt-2">
      {data && (
        <ChiefPageSnapshot
          route="/"
          label="Home — today's focus"
          state={{ top: data.top, waiting: data.waiting, open_count: data.openCount }}
        />
      )}

      {/* Date + avatar */}
      <div className="flex items-center justify-between pt-1">
        <div className="font-mono text-[11px] tracking-[0.12em] text-ink-3">
          {now || " "}
        </div>
        <Link
          href="/config"
          aria-label="Config"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-ink-2"
          style={{ background: "var(--raised)" }}
        >
          {initial}
        </Link>
      </div>

      {/* Chief's narrative */}
      {data === null ? (
        <div className="font-serif text-[20px] leading-[1.4] text-ink-3">
          Reading the board…
        </div>
      ) : data.narrative ? (
        <Narrative text={data.narrative} />
      ) : data.top.length === 0 ? (
        <div className="flex flex-col gap-4">
          <div className="font-serif text-[20px] leading-[1.4] text-ink">
            Nothing on the board yet.
          </div>
          <button
            onClick={() => chief.openAndSend(SETUP_INTERVIEW_PROMPT)}
            className="flex h-[52px] items-center justify-center gap-2 rounded-card text-[16px] font-semibold"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            <span className="font-serif text-[17px] italic">C</span>
            Set up with Chief
          </button>
        </div>
      ) : null}

      {/* Since you were away — proactive events (Proactive Chief) */}
      {away.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[11px] tracking-[0.12em] text-ink-3">
            SINCE YOU WERE AWAY · {away.length}
          </div>
          {away.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-3 rounded-card border p-3.5"
              style={{
                background: "var(--surface)",
                borderColor: e.proposal ? "var(--teal-border)" : "var(--hairline)",
              }}
            >
              <div className="flex items-start gap-2.5">
                <div className="chief-voice min-w-0 flex-1 text-[15.5px] leading-snug text-ink">
                  {e.summary}
                </div>
                {e.app && (
                  <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-ink-3">
                    {e.app.toUpperCase()}
                  </span>
                )}
              </div>
              {e.proposal ? (
                <>
                  <div
                    className="rounded-control px-3 py-2 text-[13.5px] leading-snug text-ink-2"
                    style={{ background: "var(--raised)" }}
                  >
                    <span className="font-mono text-[10px] tracking-[0.1em] text-teal">
                      {e.proposal.label.toUpperCase()}
                    </span>
                    <div className="mt-1 whitespace-pre-wrap">{e.proposal.preview}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void approveAway(e)}
                      className="flex h-11 flex-[1.6] items-center justify-center rounded-control text-[15px] font-semibold"
                      style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => void resolveAway(e.id, "dismissed")}
                      className="h-11 flex-1 rounded-control border text-[15px] text-ink-2"
                      style={{ borderColor: "var(--hairline)" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => void resolveAway(e.id, "dismissed")}
                  className="self-end font-mono text-[11px] tracking-[0.06em] text-ink-3"
                >
                  GOT IT
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Top N */}
      {data && data.top.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[11px] tracking-[0.12em] text-ink-3">
            TOP {data.top.length}
          </div>
          {data.top.map((t, i) => (
            <Link
              key={t.id}
              href={t.project_id ? `/projects/${t.project_id}` : "/tasks"}
              className="box-border flex min-h-[52px] items-center gap-3 rounded-card border px-3.5 py-[7px]"
              style={{ background: "var(--surface)", borderColor: "var(--hairline)" }}
            >
              <div className="w-3.5 shrink-0 font-mono text-[13px] text-teal">
                {i + 1}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="text-[16px] font-medium leading-[1.3] text-ink">
                  {t.title}
                </div>
                <div className="flex gap-[7px] whitespace-nowrap font-mono text-[11px] text-ink-3">
                  {t.priority && (
                    <span
                      className={
                        t.priority === "P0" || t.priority === "P1"
                          ? "text-copper"
                          : undefined
                      }
                    >
                      {t.priority}
                    </span>
                  )}
                  {t.unblocked ? (
                    <span style={{ color: "var(--ok)" }}>unblocked today</span>
                  ) : (
                    <>
                      {dueLabelShort(t.due_at) && <span>{dueLabelShort(t.due_at)}</span>}
                      {t.effortNote && <span>{t.effortNote}</span>}
                    </>
                  )}
                </div>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12" className="shrink-0" aria-hidden="true">
                <path
                  d="M1 1l5 5-5 5"
                  stroke="var(--ink-3)"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* Pending proposals from the shared conversation */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[11px] tracking-[0.12em] text-ink-3">
            PROPOSALS{pendingCount > 0 ? ` · ${pendingCount}` : ""}
          </div>
          <ProposalGroup items={pending} handlers={handlers} />
        </div>
      )}

      {/* Waiting-on strip */}
      {data && data.waiting.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="font-mono text-[11px] tracking-[0.12em] text-ink-3">
            WAITING ON
          </div>
          <div
            className="flex flex-col overflow-hidden rounded-card border"
            style={{ background: "var(--surface)", borderColor: "var(--hairline)" }}
          >
            {data.waiting.map((w, i) => (
              <div
                key={w.taskId}
                className="box-border flex min-h-[46px] items-center gap-3 px-3.5 py-1.5"
                style={
                  i < data.waiting.length - 1
                    ? { borderBottom: "1px solid var(--hairline)" }
                    : undefined
                }
              >
                <div
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{
                    background:
                      w.state === "moved"
                        ? "var(--ok)"
                        : w.state === "aging"
                          ? "var(--copper)"
                          : "var(--ink-3)",
                  }}
                  aria-hidden="true"
                />
                <div
                  className={`min-w-0 flex-1 truncate text-[15px] ${
                    w.state === "moved" ? "text-ink" : "text-ink-2"
                  }`}
                >
                  {w.who} — {w.state === "moved" ? (
                    <span className="font-semibold" style={{ color: "var(--ok)" }}>
                      replied
                    </span>
                  ) : (
                    w.what
                  )}
                </div>
                {w.state === "moved" ? (
                  <Link
                    href="/inbox"
                    className="shrink-0 whitespace-nowrap text-[14px] font-semibold text-teal"
                  >
                    review →
                  </Link>
                ) : (
                  <div
                    className="shrink-0 whitespace-nowrap font-mono text-[11px]"
                    style={{
                      color: w.state === "aging" ? "var(--copper)" : "var(--ink-3)",
                    }}
                  >
                    {w.state === "aging" ? `day ${w.days}` : `quiet ${w.days}d`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
