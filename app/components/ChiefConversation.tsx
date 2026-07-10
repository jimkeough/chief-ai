"use client";

// The Chief conversation surface — shared by the overlay sheet (opened from
// the Chief bar) and the /chief page, both bound to the one conversation in
// ChiefProvider. User turns render as compact sans bubbles; Chief speaks in
// the serif voice; proposals render as approve/dismiss cards inline under the
// turn that produced them.

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChief, type ConnectSuggestion } from "./ChiefProvider";
import ProposalGroup from "./ProposalCards";
import ChiefMonogram from "./ChiefMonogram";

// A "Connect X" card Chief offers mid-chat when the request needs an app the
// user hasn't linked. Tapping enables the app and opens the hosted OAuth flow
// in a new tab; the user connects, then re-asks. Connecting is inherently
// user-approved (the OAuth screen is the approval), so this isn't the gated
// write path — but it still only ever happens on an explicit tap.
function ConnectCard({ suggestion }: { suggestion: ConnectSuggestion }) {
  const [state, setState] = useState<"idle" | "opening" | "opened" | "error">(
    "idle",
  );
  const connect = async () => {
    if (state === "opening") return;
    setState("opening");
    try {
      const res = await fetch("/api/connect/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: suggestion.app }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
      };
      if (body.ok && body.url) {
        window.open(body.url, "_blank", "noopener");
        setState("opened");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  };
  return (
    <div
      className="rounded-card border p-3.5"
      style={{ background: "var(--surface)", borderColor: "var(--teal-border)" }}
    >
      <div className="mb-1 font-mono text-[11px] tracking-[0.1em] text-teal">
        CONNECT {suggestion.name.toUpperCase()}
      </div>
      {suggestion.reason && (
        <div className="mb-3 text-[17px] leading-snug text-ink">
          {suggestion.reason}
        </div>
      )}
      {state === "opened" ? (
        <div className="text-[16px] text-ink-2">
          Authorize in the new tab, then ask me again.
        </div>
      ) : (
        <button
          onClick={() => void connect()}
          disabled={state === "opening"}
          className="flex h-12 w-full items-center justify-center rounded-control text-[17px] font-semibold disabled:opacity-60"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          {state === "opening"
            ? "Opening…"
            : state === "error"
              ? "Try again"
              : `Connect ${suggestion.name} →`}
        </button>
      )}
    </div>
  );
}

export default function ChiefConversation() {
  const { messages, streaming, send, approve, dismiss, restore, undo } =
    useChief();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    void send(text);
  };

  const handlers = {
    onApprove: (uid: string, mergeTargetId?: string) =>
      void approve(uid, mergeTargetId),
    onDismiss: dismiss,
    onRestore: restore,
    onUndo: (uid: string) => void undo(uid),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3"
      >
        {messages.length === 0 ? (
          <div className="flex items-start gap-3 pt-4">
            <ChiefMonogram size={28} className="mt-1 shrink-0" />
            <p className="chief-voice text-narrative text-ink">
              What can I take off your plate?
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div
                    className="max-w-[85%] rounded-card px-3.5 py-2.5 text-[18px] leading-relaxed text-ink"
                    style={{ background: "var(--raised)" }}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex flex-col gap-2.5">
                  {(m.content || (!m.proposals && !m.connect)) && (
                    <div className="flex items-start gap-3">
                      <ChiefMonogram size={24} className="mt-1 shrink-0" />
                      <div className="chief-prose min-w-0 flex-1 text-ink">
                        {m.content ? (
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {m.content}
                          </Markdown>
                        ) : streaming && i === messages.length - 1 ? (
                          <span className="text-ink-3">…</span>
                        ) : (
                          ""
                        )}
                      </div>
                    </div>
                  )}
                  {m.proposals && m.proposals.length > 0 && (
                    <div className="pl-9">
                      <ProposalGroup items={m.proposals} handlers={handlers} />
                    </div>
                  )}
                  {m.connect && m.connect.length > 0 && (
                    <div className="flex flex-col gap-2 pl-9">
                      {m.connect.map((c) => (
                        <ConnectCard key={c.app} suggestion={c} />
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        className="border-t px-3 pb-3 pt-2.5"
        style={{ borderColor: "var(--hairline)" }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask Chief…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-control border bg-transparent px-3.5 py-2.5 text-[18px] leading-snug text-ink outline-none placeholder:text-ink-3"
            style={{ borderColor: "var(--hairline)" }}
          />
          <button
            onClick={submit}
            disabled={streaming || !draft.trim()}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control disabled:opacity-40"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 13V3M3.5 7.5L8 3l4.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
