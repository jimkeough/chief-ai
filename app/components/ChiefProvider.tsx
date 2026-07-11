"use client";

// Chief's client-side brain: one conversation shared by every surface (the
// launcher-opened sheet and the /chief page), plus the proposal state machine.
//
// The provider owns:
//  - the message list (streamed text + attached proposal cards),
//  - the page context (what screen the user opened Chief from — pages register
//    it via <ChiefPageSnapshot/>),
//  - the proposal lifecycle: proposed → executing → done (receipt with Undo) /
//    error, or dismissed → restorable. Approve is the ONLY thing that calls
//    /api/actions/execute — Chief itself never writes.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { PROPOSALS_MARKER, type ProposedAction } from "@/lib/actions";
import type { ChiefPageContext } from "@/lib/chief";
import type { UndoDescriptor } from "@/lib/undo";
import type { ChatAttachment } from "@/lib/chat-attachments";

export type ProposalStatus =
  | "proposed"
  | "executing"
  | "done"
  | "error"
  | "dismissed"
  | "superseded"
  | "undoing"
  | "undone";

export type ProposalItem = {
  uid: string;
  proposal: ProposedAction;
  status: ProposalStatus;
  /** Receipt line after a successful execute ("Task added — …"). */
  result?: string;
  error?: string;
  /** Inverse descriptor from the executor; powers the receipt's Undo. */
  undo?: UndoDescriptor | null;
};

/** A Chief-suggested app connection, rendered as a "Connect X" card. */
export type ConnectSuggestion = { app: string; name: string; reason: string };

export type ProposalPlan = {
  version: number;
  sourceNames: string[];
  /** Kept in memory so a revision can re-read the original source files. */
  sourceAttachments: ChatAttachment[];
};

export type ChiefMessage = {
  role: "user" | "assistant";
  content: string;
  proposals?: ProposalItem[];
  connect?: ConnectSuggestion[];
  /** Present when this assistant turn is a reviewable document-import plan. */
  plan?: ProposalPlan;
  /** Files attached to this (user) turn, for display only — name + kind. */
  attachments?: { name: string; kind: ChatAttachment["kind"] }[];
};

type SendOptions = {
  /** Model-facing text when it needs more context than the visible user turn. */
  apiText?: string;
  plan?: ProposalPlan;
  showAttachments?: boolean;
};

type ChiefContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  page: ChiefPageContext | null;
  setPage: (page: ChiefPageContext | null) => void;
  messages: ChiefMessage[];
  streaming: boolean;
  pendingCount: number;
  send: (
    text: string,
    attachments?: ChatAttachment[],
    options?: SendOptions,
  ) => Promise<boolean>;
  revisePlan: (
    items: ProposalItem[],
    instruction: string,
    plan: ProposalPlan,
  ) => Promise<void>;
  /** Open the sheet and immediately send a preset message (no-op if a reply
   *  is already streaming — the sheet still opens). */
  openAndSend: (text: string) => void;
  approve: (uid: string, mergeTargetId?: string) => Promise<void>;
  dismiss: (uid: string) => void;
  restore: (uid: string) => void;
  undo: (uid: string) => Promise<void>;
  clear: () => void;
};

/** The on-demand concierge opener: works on any workspace, not just an empty
 *  one — the message itself carries the interview instructions. */
export const SETUP_INTERVIEW_PROMPT =
  "Interview me about my work — one question at a time — and as real structure emerges, propose the projects, tasks, contacts, and standing instructions to capture it. Start by asking what I do and what's on my plate right now.";

const ChiefCtx = createContext<ChiefContextValue | null>(null);

export function useChief(): ChiefContextValue {
  const ctx = useContext(ChiefCtx);
  if (!ctx) throw new Error("useChief must be used inside <ChiefProvider>");
  return ctx;
}

let uidCounter = 0;
const nextUid = () => `p${++uidCounter}`;

export default function ChiefProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ChiefPageContext | null>(null);
  const [messages, setMessages] = useState<ChiefMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  // The transcript sent to the API: assistant turns as plain text (tool_use
  // blocks and proposals live server-side per turn; the follow-up transcript
  // is text-only, same as the app this was ported from).
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    [],
  );

  // Default page context when the current screen didn't register one.
  const effectivePage: ChiefPageContext = useMemo(
    () =>
      page ?? {
        route: pathname ?? "/",
        label: routeLabel(pathname ?? "/"),
      },
    [page, pathname],
  );

  const patchProposal = useCallback(
    (uid: string, patch: Partial<ProposalItem>) => {
      setMessages((msgs) =>
        msgs.map((m) =>
          m.proposals?.some((p) => p.uid === uid)
            ? {
                ...m,
                proposals: m.proposals.map((p) =>
                  p.uid === uid ? { ...p, ...patch } : p,
                ),
              }
            : m,
        ),
      );
    },
    [],
  );

  const findProposal = useCallback(
    (uid: string): ProposalItem | undefined => {
      for (const m of messages) {
        const hit = m.proposals?.find((p) => p.uid === uid);
        if (hit) return hit;
      }
      return undefined;
    },
    [messages],
  );

  const send = useCallback(
    async (
      text: string,
      attachments?: ChatAttachment[],
      options?: SendOptions,
    ): Promise<boolean> => {
      const trimmed = text.trim();
      const apiText = options?.apiText?.trim() || trimmed;
      const atts = attachments ?? [];
      if ((!apiText && atts.length === 0) || streaming) return false;
      setStreaming(true);
      const plan =
        options?.plan ??
        (atts.length > 0
          ? {
              version: 1,
              sourceNames: atts.map((attachment) => attachment.name),
              sourceAttachments: atts,
            }
          : undefined);
      // The transcript re-sent on every future turn must carry non-empty text
      // for every message — an attachment-only turn still needs a stand-in
      // line here (the attachment itself only rides along on THIS request).
      const historyText = apiText || "(sent a file)";
      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: historyText },
      ];
      setMessages((m) => [
        ...m,
        {
          role: "user",
          content: trimmed,
          ...(atts.length && options?.showAttachments !== false
            ? { attachments: atts.map((a) => ({ name: a.name, kind: a.kind })) }
            : {}),
        },
        {
          role: "assistant",
          content: "",
          ...(plan ? { plan } : {}),
        },
      ]);

      let succeeded = true;
      let receivedPlan = false;
      try {
        const res = await fetch("/api/chief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyRef.current,
            page: effectivePage,
            ...(atts.length ? { attachments: atts } : {}),
            ...(plan ? { requireProposalPlan: true } : {}),
          }),
        });
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Chief is unavailable (${res.status}).`);
        }

        // Stream text into the trailing assistant message; a record-separator
        // marker splits prose from the trailing proposals JSON blob. The marker
        // can land mid-chunk, so parse against the accumulated buffer.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const render = () => {
          const cut = buffer.indexOf(PROPOSALS_MARKER);
          const textPart = cut === -1 ? buffer : buffer.slice(0, cut);
          setMessages((msgs) => {
            const out = [...msgs];
            const last = out[out.length - 1];
            if (last?.role === "assistant") {
              out[out.length - 1] = { ...last, content: textPart };
            }
            return out;
          });
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          render();
        }
        buffer += decoder.decode();
        render();

        const cut = buffer.indexOf(PROPOSALS_MARKER);
        const finalText = (cut === -1 ? buffer : buffer.slice(0, cut)).trim();
        historyRef.current = [
          ...historyRef.current,
          { role: "assistant", content: finalText || "(cards below)" },
        ];

        if (cut !== -1) {
          try {
            const blob = JSON.parse(buffer.slice(cut + 1)) as {
              proposals?: ProposedAction[];
              connect?: ConnectSuggestion[];
            };
            const items: ProposalItem[] = (blob.proposals ?? []).map((p) => ({
              uid: nextUid(),
              proposal: p,
              status: "proposed",
            }));
            const connect = blob.connect ?? [];
            receivedPlan = items.length > 0;
            if (items.length > 0 || connect.length > 0) {
              setMessages((msgs) => {
                const out = [...msgs];
                const last = out[out.length - 1];
                if (last?.role === "assistant") {
                  out[out.length - 1] = {
                    ...last,
                    ...(items.length > 0 ? { proposals: items } : {}),
                    ...(connect.length > 0 ? { connect } : {}),
                  };
                }
                return out;
              });
            }
          } catch {
            /* malformed blob — leave the text as-is */
          }
        }
        if (plan && !receivedPlan) succeeded = false;
      } catch (e) {
        succeeded = false;
        const detail = e instanceof Error ? e.message : "Something went wrong.";
        setMessages((msgs) => {
          const out = [...msgs];
          const last = out[out.length - 1];
          if (last?.role === "assistant") {
            out[out.length - 1] = {
              ...last,
              content: `${last.content}\n\n⚠️ ${detail}`.trim(),
            };
          }
          return out;
        });
      } finally {
        setStreaming(false);
      }
      return succeeded;
    },
    [effectivePage, streaming],
  );

  const revisePlan = useCallback(
    async (
      items: ProposalItem[],
      instruction: string,
      plan: ProposalPlan,
    ) => {
      const request = instruction.trim();
      const replaceable = items.filter(
        (item) => item.status === "proposed" || item.status === "error",
      );
      if (!request || replaceable.length === 0 || streaming) return;

      const ids = new Set(replaceable.map((item) => item.uid));
      const previous = new Map(
        replaceable.map((item) => [item.uid, item.status] as const),
      );
      setMessages((msgs) =>
        msgs.map((message) =>
          message.proposals?.some((item) => ids.has(item.uid))
            ? {
                ...message,
                proposals: message.proposals.map((item) =>
                  ids.has(item.uid)
                    ? { ...item, status: "superseded" as const }
                    : item,
                ),
              }
            : message,
        ),
      );

      const currentPlan = replaceable.map((item) => ({
        key: item.proposal.key,
        args: item.proposal.args,
        ...(item.proposal.server ? { server: item.proposal.server } : {}),
      }));
      const apiText = [
        "Revise the pending DOCUMENT IMPORT PLAN.",
        "The old cards are now superseded. Return the COMPLETE replacement set of proposals, not just the changed items.",
        "Re-read the attached source files and compare them with the current saved projects and tasks.",
        "Do not execute anything. Do not repeat an item the user asks to remove. If the request exposes an unresolved conflict, explain it and omit that write until the user resolves it.",
        `Source files: ${plan.sourceNames.join(", ")}`,
        `Current plan: ${JSON.stringify(currentPlan)}`,
        `User's requested changes: ${request}`,
      ].join("\n\n");

      const succeeded = await send(request, plan.sourceAttachments, {
        apiText,
        showAttachments: false,
        plan: {
          version: plan.version + 1,
          sourceNames: plan.sourceNames,
          sourceAttachments: plan.sourceAttachments,
        },
      });
      if (!succeeded) {
        setMessages((msgs) =>
          msgs.map((message) =>
            message.proposals?.some((item) => ids.has(item.uid))
              ? {
                  ...message,
                  proposals: message.proposals.map((item) => {
                    const status = previous.get(item.uid);
                    return status ? { ...item, status } : item;
                  }),
                }
              : message,
          ),
        );
      }
    },
    [send, streaming],
  );

  const openAndSend = useCallback(
    (text: string) => {
      setOpen(true);
      if (!streaming) void send(text);
    },
    [send, streaming],
  );

  const approve = useCallback(
    async (uid: string, mergeTargetId?: string) => {
      const item = findProposal(uid);
      if (
        !item ||
        (item.status !== "proposed" && item.status !== "error")
      ) {
        return;
      }
      patchProposal(uid, { status: "executing", error: undefined });
      try {
        const res = await fetch("/api/actions/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: item.proposal.key,
            args: item.proposal.args,
            ...(item.proposal.server ? { server: item.proposal.server } : {}),
            ...(mergeTargetId ? { mergeTargetId } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          result?: string;
          error?: string;
          undo?: UndoDescriptor;
        };
        if (res.ok && data.ok) {
          patchProposal(uid, {
            status: "done",
            result: data.result ?? "Done.",
            undo: data.undo ?? null,
          });
        } else {
          patchProposal(uid, {
            status: "error",
            error: data.error ?? "Action failed.",
          });
        }
      } catch {
        patchProposal(uid, { status: "error", error: "Action failed." });
      }
    },
    [findProposal, patchProposal],
  );

  const dismiss = useCallback(
    (uid: string) => patchProposal(uid, { status: "dismissed" }),
    [patchProposal],
  );
  const restore = useCallback(
    (uid: string) => patchProposal(uid, { status: "proposed", error: undefined }),
    [patchProposal],
  );

  const undo = useCallback(
    async (uid: string) => {
      const item = findProposal(uid);
      if (!item || item.status !== "done" || !item.undo) return;
      patchProposal(uid, { status: "undoing" });
      try {
        const res = await fetch("/api/actions/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ undo: item.undo }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          result?: string;
          error?: string;
        };
        if (res.ok && data.ok) {
          patchProposal(uid, { status: "undone", result: data.result });
        } else {
          patchProposal(uid, {
            status: "done",
            error: data.error ?? "Undo failed.",
          });
        }
      } catch {
        patchProposal(uid, { status: "done", error: "Undo failed." });
      }
    },
    [findProposal, patchProposal],
  );

  const clear = useCallback(() => {
    historyRef.current = [];
    setMessages([]);
  }, []);

  const pendingCount = useMemo(
    () =>
      messages.reduce(
        (n, m) =>
          n + (m.proposals?.filter((p) => p.status === "proposed").length ?? 0),
        0,
      ),
    [messages],
  );

  const value = useMemo<ChiefContextValue>(
    () => ({
      open,
      setOpen,
      page,
      setPage,
      messages,
      streaming,
      pendingCount,
      send,
      revisePlan,
      openAndSend,
      approve,
      dismiss,
      restore,
      undo,
      clear,
    }),
    [
      open,
      page,
      messages,
      streaming,
      pendingCount,
      send,
      revisePlan,
      openAndSend,
      approve,
      dismiss,
      restore,
      undo,
      clear,
    ],
  );

  return <ChiefCtx.Provider value={value}>{children}</ChiefCtx.Provider>;
}

// Fallback sheet-header labels when a page didn't register a snapshot.
function routeLabel(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/inbox")) return "Inbox";
  if (pathname.startsWith("/projects")) return "Projects";
  if (pathname.startsWith("/tasks")) return "Tasks";
  if (pathname.startsWith("/chief")) return "Chief";
  return pathname;
}
