"use client";

// The Chief conversation surface — shared by the launcher-opened overlay sheet
// and the /chief page, both bound to the one conversation in
// ChiefProvider. User turns render as compact sans bubbles; Chief speaks in
// the serif voice; proposals render as approve/dismiss cards inline under the
// turn that produced them.

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChief } from "./ChiefProvider";
import ProposalGroup from "./ProposalCards";
import ChiefMonogram from "./ChiefMonogram";
import type { ChatAttachment } from "@/lib/chat-attachments";
import {
  filesToChatAttachments,
  MAX_CHAT_FILES,
} from "@/lib/chat-attachment-client";
import { capturePageAttachment } from "@/lib/capture-page";

// A small icon per attachment kind for the chip/bubble display.
function AttachmentGlyph({ kind }: { kind: ChatAttachment["kind"] }) {
  const label = kind === "image" ? "IMG" : kind === "document" ? "PDF" : "TXT";
  return (
    <span className="font-mono text-[9px] tracking-[0.06em] text-ink-3">
      {label}
    </span>
  );
}

export default function ChiefConversation() {
  const {
    messages,
    streaming,
    send,
    runIntent,
    revisePlan,
    approve,
    dismiss,
    restore,
    undo,
  } =
    useChief();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest turn in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Grow the composer to fit what's typed, capped by the textarea's CSS
  // max-height (which then scrolls). Runs whenever the draft changes, so
  // clearing it on send snaps back to a single row.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if ((!text && pending.length === 0) || streaming) return;
    setDraft("");
    const atts = pending;
    setPending([]);
    void send(text, atts);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachError(null);
    const room = MAX_CHAT_FILES - pending.length;
    if (room <= 0) {
      setAttachError(`You can attach up to ${MAX_CHAT_FILES} files.`);
      return;
    }
    const result = await filesToChatAttachments(files, room);
    if (result.attachments.length) {
      setPending((current) => [...current, ...result.attachments]);
    }
    if (result.error) setAttachError(result.error);
  };

  const removePending = (index: number) =>
    setPending((p) => p.filter((_, i) => i !== index));

  // Capture the page underneath the Chief sheet (the app screen the user is
  // looking at) and attach it. Targets <main>, so the sheet overlay is excluded.
  const capturePage = async () => {
    if (capturing) return;
    setAttachError(null);
    if (pending.length >= MAX_CHAT_FILES) {
      setAttachError(`You can attach up to ${MAX_CHAT_FILES} files.`);
      return;
    }
    setCapturing(true);
    try {
      const attachment = await capturePageAttachment();
      setPending((current) => [...current, attachment]);
    } catch (error) {
      setAttachError(
        error instanceof Error ? error.message : "Couldn't capture the page.",
      );
    } finally {
      setCapturing(false);
    }
  };

  const handlers = {
    onApprove: (uid: string, mergeTargetId?: string) =>
      approve(uid, mergeTargetId),
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
            <div className="flex flex-col gap-3">
              <p className="chief-voice text-narrative text-ink">
                What can I take off your plate?
              </p>
              <button
                type="button"
                onClick={() => void runIntent({ id: "app.update" })}
                className="flex items-center gap-2 self-start rounded-control border px-3 py-2 text-left text-[13px] text-ink-2"
                style={{ borderColor: "var(--teal-border)" }}
              >
                <span className="font-serif text-[15px] italic text-teal">C</span>
                Update this app
              </button>
              <p className="text-[12px] leading-snug text-ink-3">
                Attach a file with the clip to have me read it. To build a
                project/task plan from a document, use Config → Setup Chief.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                      {m.attachments.map((a, j) => (
                        <div
                          key={j}
                          className="flex items-center gap-1.5 rounded-full border px-2.5 py-1"
                          style={{ borderColor: "var(--hairline)" }}
                        >
                          <AttachmentGlyph kind={a.kind} />
                          <span className="max-w-[160px] truncate text-[12px] text-ink-2">
                            {a.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.content && (
                    <div
                      className="max-w-[85%] rounded-card px-3.5 py-2.5 text-[18px] leading-relaxed text-ink"
                      style={{ background: "var(--raised)" }}
                    >
                      {m.content}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="flex flex-col gap-2.5">
                  {(m.content || !m.proposals) && (
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
                      <ProposalGroup
                        items={m.proposals}
                        handlers={handlers}
                        plan={m.plan}
                        revisionDisabled={streaming}
                        onRevise={
                          m.plan
                            ? (instruction) =>
                                revisePlan(m.proposals!, instruction, m.plan!)
                            : undefined
                        }
                      />
                    </div>
                  )}
                  {m.suggestions &&
                    m.suggestions.length > 0 &&
                    i === messages.length - 1 &&
                    !streaming && (
                      <div className="flex flex-wrap gap-2 pl-9">
                        {m.suggestions.map((s, k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => void send(s)}
                            className="rounded-full border px-3 py-1.5 text-[13px] font-medium text-ink"
                            style={{
                              borderColor: "var(--teal-border)",
                              background: "var(--surface)",
                            }}
                          >
                            {s}
                          </button>
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
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pending.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1.5"
                style={{ borderColor: "var(--hairline)" }}
              >
                <AttachmentGlyph kind={a.kind} />
                <span className="max-w-[140px] truncate text-[12px] text-ink-2">
                  {a.name}
                </span>
                <button
                  type="button"
                  onClick={() => removePending(i)}
                  aria-label={`Remove ${a.name}`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink-3"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                    <path
                      d="M1 1l6 6m0-6L1 7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && (
          <div className="mb-2 text-[12px] text-copper">{attachError}</div>
        )}
        <div className="mb-2 flex">
          <button
            type="button"
            onClick={() => void capturePage()}
            disabled={capturing || streaming}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-ink-2 disabled:opacity-50"
            style={{ borderColor: "var(--hairline)" }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="1.5"
                y="4"
                width="13"
                height="9.5"
                rx="1.6"
                stroke="var(--ink-2)"
                strokeWidth="1.3"
              />
              <circle cx="8" cy="8.75" r="2.5" stroke="var(--ink-2)" strokeWidth="1.3" />
              <path
                d="M5.5 4l1-1.5h3L10.5 4"
                stroke="var(--ink-2)"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            {capturing ? "Capturing…" : "Capture page"}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,text/csv,.md,.csv"
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            aria-label="Attach a document"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border disabled:opacity-40"
            style={{ borderColor: "var(--hairline)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M11 4.5L5.5 10a2 2 0 102.83 2.83l5-5.33a3.5 3.5 0 10-4.95-4.95L3 8.03"
                stroke="var(--ink-2)"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
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
            className="max-h-48 min-h-[44px] flex-1 resize-none overflow-y-auto rounded-control border bg-transparent px-3.5 py-2.5 text-[18px] leading-snug text-ink outline-none placeholder:text-ink-3"
            style={{ borderColor: "var(--hairline)" }}
          />
          <button
            onClick={submit}
            disabled={streaming || (!draft.trim() && pending.length === 0)}
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
