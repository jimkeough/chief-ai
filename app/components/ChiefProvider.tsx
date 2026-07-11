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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { PROPOSALS_MARKER, type ProposedAction } from "@/lib/actions";
import type { ChiefPageContext } from "@/lib/chief";
import type { UndoDescriptor } from "@/lib/undo";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { storeChiefAttachments } from "@/lib/chat-attachment-client";
import {
  DOCUMENT_REVIEW_INTENT,
  resolveChiefIntent,
  type ChiefIntent,
  type ChiefIntentId,
} from "@/lib/chief-intents";
import type {
  ChiefHistoryMessage,
  ChiefSessionRecord,
  ChiefSessionSummary,
} from "@/lib/chief-session-types";

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

export type ProposalPlan = {
  version: number;
  sourceNames: string[];
  /** Kept in memory so a revision can re-read the original source files. */
  sourceAttachments?: ChatAttachment[];
  /** Durable references used to restore source files after a reload. */
  sourceAttachmentIds?: string[];
};

export type ChiefMessage = {
  role: "user" | "assistant";
  content: string;
  proposals?: ProposalItem[];
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
  sessionId: string | null;
  recentSessions: ChiefSessionSummary[];
  sessionsLoading: boolean;
  messages: ChiefMessage[];
  streaming: boolean;
  pendingCount: number;
  refreshRecentSessions: () => Promise<void>;
  newChat: (intent?: ChiefIntentId, title?: string) => Promise<boolean>;
  switchSession: (id: string) => Promise<void>;
  runIntent: (intent: ChiefIntent) => Promise<void>;
  uploadDocuments: (attachments: ChatAttachment[]) => Promise<void>;
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
  approve: (uid: string, mergeTargetId?: string) => Promise<void>;
  dismiss: (uid: string) => void;
  restore: (uid: string) => void;
  undo: (uid: string) => Promise<void>;
  clear: () => void;
};

const ChiefCtx = createContext<ChiefContextValue | null>(null);

export function useChief(): ChiefContextValue {
  const ctx = useContext(ChiefCtx);
  if (!ctx) throw new Error("useChief must be used inside <ChiefProvider>");
  return ctx;
}

const ACTIVE_SESSION_KEY = "chief.activeSessionId";
const EXECUTION_INTERRUPTED =
  "Action status is unknown after an interruption. Check your workspace before acting again.";
const UNDO_INTERRUPTED =
  "Undo was interrupted before it could be confirmed. The action may still be applied.";

function pendingProposalCount(messages: ChiefMessage[]): number {
  return messages.reduce(
    (count, message) =>
      count +
      (message.proposals?.filter((proposal) => proposal.status === "proposed")
        .length ?? 0),
    0,
  );
}

function cleanTitle(value: string | undefined): string | undefined {
  const title = value?.trim().replace(/\s+/g, " ");
  return title ? title.slice(0, 80) : undefined;
}

function deriveTitle(
  explicitTitle: string | undefined,
  userText: string,
  attachments: ChatAttachment[],
): string {
  return (
    cleanTitle(explicitTitle) ??
    cleanTitle(userText) ??
    cleanTitle(attachments[0]?.name) ??
    "New chat"
  );
}

function sessionSummary(
  session: ChiefSessionRecord<ChiefMessage>,
): ChiefSessionSummary {
  const { messages: _messages, history: _history, ...summary } = session;
  return summary;
}

function sanitizeMessages(messages: ChiefMessage[]): ChiefMessage[] {
  return messages.map((message) => {
    if (!message.plan) return message;
    const { sourceAttachments: _sourceAttachments, ...plan } = message.plan;
    return { ...message, plan };
  });
}

function isChiefMessage(value: unknown): value is ChiefMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChiefMessage>;
  if (
    (message.role !== "user" && message.role !== "assistant") ||
    typeof message.content !== "string"
  ) {
    return false;
  }
  if (message.proposals !== undefined && !Array.isArray(message.proposals)) {
    return false;
  }
  if (
    message.proposals?.some(
      (item) =>
        !item ||
        typeof item.uid !== "string" ||
        typeof item.status !== "string" ||
        !item.proposal ||
        typeof item.proposal !== "object",
    )
  ) {
    return false;
  }
  return true;
}

function normalizeInterrupted(messages: ChiefMessage[]): {
  messages: ChiefMessage[];
  changed: boolean;
} {
  let changed = false;
  const normalized = messages.map((message) => {
    if (
      message.role === "assistant" &&
      !message.content &&
      !message.proposals?.length
    ) {
      changed = true;
      return {
        ...message,
        content:
          "⚠️ This response was interrupted before Chief finished. Please try again.",
      };
    }
    if (!message.proposals) return message;
    const proposals = message.proposals.map((proposal) => {
      if (proposal.status === "executing") {
        changed = true;
        return {
          ...proposal,
          status: "done" as const,
          result: EXECUTION_INTERRUPTED,
          undo: null,
        };
      }
      if (proposal.status === "undoing") {
        changed = true;
        return {
          ...proposal,
          status: "done" as const,
          error: UNDO_INTERRUPTED,
        };
      }
      return proposal;
    });
    return { ...message, proposals };
  });
  return { messages: normalized, changed };
}

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<ChiefSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // The transcript sent to the API: assistant turns as plain text (tool_use
  // blocks and proposals live server-side per turn; the follow-up transcript
  // is text-only, same as the app this was ported from).
  const historyRef = useRef<ChiefHistoryMessage[]>([]);
  const messagesRef = useRef<ChiefMessage[]>([]);
  const streamingRef = useRef(false);
  const operationRef = useRef(false);
  const transitionRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionIntentRef = useRef<ChiefIntentId>("general");
  const sessionTitleRef = useRef("New chat");
  const desiredTitleRef = useRef<string | undefined>(undefined);
  const ensureSessionPromiseRef =
    useRef<Promise<string | null> | null>(null);
  const patchQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydrationPromiseRef = useRef<Promise<void> | null>(null);
  const hydrationStartedRef = useRef(false);
  const sessionEpochRef = useRef(0);

  const replaceMessages = useCallback((next: ChiefMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const updateMessages = useCallback(
    (updater: (current: ChiefMessage[]) => ChiefMessage[]) => {
      const next = updater(messagesRef.current);
      replaceMessages(next);
      return next;
    },
    [replaceMessages],
  );

  const setStreamingValue = useCallback((next: boolean) => {
    streamingRef.current = next;
    setStreaming(next);
  }, []);

  const upsertRecentSession = useCallback(
    (summary: ChiefSessionSummary, moveToFront = true) => {
      setRecentSessions((current) => {
        const rest = current.filter((item) => item.id !== summary.id);
        return moveToFront ? [summary, ...rest] : [...rest, summary];
      });
    },
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

  const queueSnapshot = useCallback(
    (
      targetId = sessionIdRef.current,
      snapshotMessages = messagesRef.current,
      snapshotHistory = historyRef.current,
    ): Promise<void> => {
      if (!targetId) return Promise.resolve();
      const body = {
        title: sessionTitleRef.current,
        messages: sanitizeMessages(snapshotMessages),
        history: snapshotHistory.map((item) => ({ ...item })),
        pendingCount: pendingProposalCount(snapshotMessages),
      };
      patchQueueRef.current = patchQueueRef.current
        .catch(() => {
          /* A failed save must not block later snapshots. */
        })
        .then(async () => {
          const response = await fetch(`/api/chief/sessions/${targetId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!response.ok) return;
          const data = (await response.json().catch(() => ({}))) as {
            session?: ChiefSessionSummary;
          };
          if (data.session) upsertRecentSession(data.session);
        })
        .catch(() => {
          /* Session persistence is best-effort; chat remains usable. */
        });
      return patchQueueRef.current;
    },
    [upsertRecentSession],
  );

  const patchProposal = useCallback(
    (uid: string, patch: Partial<ProposalItem>) => {
      const next = updateMessages((msgs) =>
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
      void queueSnapshot(sessionIdRef.current, next, historyRef.current);
    },
    [queueSnapshot, updateMessages],
  );

  const findProposal = useCallback(
    (uid: string): ProposalItem | undefined => {
      for (const m of messagesRef.current) {
        const hit = m.proposals?.find((p) => p.uid === uid);
        if (hit) return hit;
      }
      return undefined;
    },
    [],
  );

  const refreshRecentSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await fetch("/api/chief/sessions?limit=20");
      if (!response.ok) return;
      const data = (await response.json().catch(() => ({}))) as {
        sessions?: ChiefSessionSummary[];
      };
      if (Array.isArray(data.sessions)) setRecentSessions(data.sessions);
    } catch {
      /* Recent chats are optional; the active chat still works. */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const restoreSession = useCallback(
    (
      record: ChiefSessionRecord<ChiefMessage>,
      options?: { openSheet?: boolean; moveToFront?: boolean },
    ) => {
      const restored = normalizeInterrupted(
        Array.isArray(record.messages)
          ? record.messages.filter(isChiefMessage)
          : [],
      );
      const history = Array.isArray(record.history) ? record.history : [];
      sessionIdRef.current = record.id;
      sessionIntentRef.current = record.intent;
      sessionTitleRef.current = record.title;
      desiredTitleRef.current = record.title;
      historyRef.current = history;
      setSessionId(record.id);
      replaceMessages(restored.messages);
      try {
        window.localStorage.setItem(ACTIVE_SESSION_KEY, record.id);
      } catch {
        /* Storage can be unavailable in privacy-restricted browsers. */
      }
      upsertRecentSession(
        sessionSummary(record),
        options?.moveToFront !== false,
      );
      if (options?.openSheet) setOpen(true);
      if (restored.changed) {
        void queueSnapshot(record.id, restored.messages, history);
      }
    },
    [queueSnapshot, replaceMessages, upsertRecentSession],
  );

  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    const epoch = sessionEpochRef.current;
    const hydrate = async () => {
      setSessionsLoading(true);
      try {
        const listResponse = await fetch("/api/chief/sessions?limit=20");
        const listData = listResponse.ok
          ? ((await listResponse.json().catch(() => ({}))) as {
              sessions?: ChiefSessionSummary[];
            })
          : {};
        const recent = Array.isArray(listData.sessions)
          ? listData.sessions
          : [];
        setRecentSessions(recent);
        if (sessionEpochRef.current !== epoch) return;

        let storedId: string | null = null;
        try {
          storedId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
        } catch {
          /* Fall back to the newest session. */
        }
        const candidates = [storedId, recent[0]?.id].filter(
          (id, index, all): id is string =>
            Boolean(id) && all.indexOf(id) === index,
        );
        for (const id of candidates) {
          const response = await fetch(`/api/chief/sessions/${id}`);
          if (!response.ok) continue;
          const data = (await response.json().catch(() => ({}))) as {
            session?: ChiefSessionRecord<ChiefMessage>;
          };
          if (!data.session || sessionEpochRef.current !== epoch) return;
          restoreSession(data.session);
          return;
        }
      } catch {
        /* Hydration is best-effort; sending can still create a new chat. */
      } finally {
        setSessionsLoading(false);
      }
    };
    const promise = hydrate();
    hydrationPromiseRef.current = promise;
    void promise.finally(() => {
      if (hydrationPromiseRef.current === promise) {
        hydrationPromiseRef.current = null;
      }
    });
  }, [restoreSession]);

  const ensureSession = useCallback(
    async (
      userText: string,
      attachments: ChatAttachment[],
    ): Promise<string | null> => {
      if (sessionIdRef.current) return sessionIdRef.current;
      if (hydrationPromiseRef.current) await hydrationPromiseRef.current;
      if (sessionIdRef.current) return sessionIdRef.current;
      if (ensureSessionPromiseRef.current) return ensureSessionPromiseRef.current;

      const epoch = sessionEpochRef.current;
      const title = deriveTitle(
        desiredTitleRef.current,
        userText,
        attachments,
      );
      const create = (async () => {
        try {
          const response = await fetch("/api/chief/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              intent: sessionIntentRef.current,
              title,
              pageLabel: effectivePage.label,
            }),
          });
          if (!response.ok) return null;
          const data = (await response.json().catch(() => ({}))) as {
            session?: ChiefSessionRecord<ChiefMessage>;
          };
          if (!data.session || sessionEpochRef.current !== epoch) {
            return sessionIdRef.current;
          }
          sessionIdRef.current = data.session.id;
          sessionTitleRef.current = data.session.title;
          desiredTitleRef.current = data.session.title;
          setSessionId(data.session.id);
          try {
            window.localStorage.setItem(ACTIVE_SESSION_KEY, data.session.id);
          } catch {
            /* The database session remains the source of truth. */
          }
          upsertRecentSession(sessionSummary(data.session));
          return data.session.id;
        } catch {
          return null;
        }
      })();
      ensureSessionPromiseRef.current = create;
      try {
        return await create;
      } finally {
        if (ensureSessionPromiseRef.current === create) {
          ensureSessionPromiseRef.current = null;
        }
      }
    },
    [effectivePage.label, upsertRecentSession],
  );

  const newChat = useCallback(
    async (
      intent: ChiefIntentId = "general",
      title?: string,
    ): Promise<boolean> => {
      if (
        streamingRef.current ||
        operationRef.current ||
        transitionRef.current
      ) {
        return false;
      }
      if (
        pendingProposalCount(messagesRef.current) > 0 &&
        !window.confirm(
          "This chat has pending proposals. They will remain saved in the previous chat. Start a new chat?",
        )
      ) {
        return false;
      }
      sessionEpochRef.current += 1;
      sessionIdRef.current = null;
      sessionIntentRef.current = intent;
      desiredTitleRef.current = cleanTitle(title);
      sessionTitleRef.current = desiredTitleRef.current ?? "New chat";
      ensureSessionPromiseRef.current = null;
      historyRef.current = [];
      setSessionId(null);
      replaceMessages([]);
      try {
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      } catch {
        /* A fresh in-memory chat still works without localStorage. */
      }
      return true;
    },
    [replaceMessages],
  );

  const switchSession = useCallback(
    async (id: string): Promise<void> => {
      if (
        !id ||
        streamingRef.current ||
        operationRef.current ||
        transitionRef.current ||
        id === sessionIdRef.current
      ) {
        if (id === sessionIdRef.current) setOpen(true);
        return;
      }
      transitionRef.current = true;
      const epoch = ++sessionEpochRef.current;
      setSessionsLoading(true);
      try {
        await patchQueueRef.current.catch(() => {});
        if (sessionEpochRef.current !== epoch) return;
        const response = await fetch(`/api/chief/sessions/${id}`);
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as {
          session?: ChiefSessionRecord<ChiefMessage>;
        };
        if (!data.session || sessionEpochRef.current !== epoch) return;
        ensureSessionPromiseRef.current = null;
        restoreSession(data.session, { openSheet: true });
      } catch {
        /* Leave the current conversation intact when restoration fails. */
      } finally {
        transitionRef.current = false;
        setSessionsLoading(false);
      }
    },
    [restoreSession],
  );

  const send = useCallback(
    async (
      text: string,
      attachments?: ChatAttachment[],
      options?: SendOptions,
    ): Promise<boolean> => {
      const trimmed = text.trim();
      const atts = attachments ?? [];
      const suppliedApiText = options?.apiText?.trim();
      if (
        (!trimmed && !suppliedApiText && atts.length === 0) ||
        streamingRef.current ||
        operationRef.current ||
        transitionRef.current
      ) {
        return false;
      }
      setStreamingValue(true);

      const activeSessionId = await ensureSession(trimmed, atts);
      const documentOnly =
        !trimmed &&
        atts.length > 0 &&
        !suppliedApiText;
      const visibleText = documentOnly
        ? DOCUMENT_REVIEW_INTENT.displayText
        : trimmed;
      const apiText =
        suppliedApiText ||
        (documentOnly ? DOCUMENT_REVIEW_INTENT.apiText : trimmed);
      let sourceAttachmentIds: string[] = [];
      if (!options?.plan && atts.length > 0) {
        if (!activeSessionId) {
          updateMessages((current) => [
            ...current,
            {
              role: "user",
              content: visibleText,
              attachments: atts.map((attachment) => ({
                name: attachment.name,
                kind: attachment.kind,
              })),
            },
            {
              role: "assistant",
              content:
                "⚠️ I couldn't start a saved chat for these documents. Apply the latest database migration and try again.",
            },
          ]);
          setStreamingValue(false);
          return false;
        }
        try {
          sourceAttachmentIds = await storeChiefAttachments(
            activeSessionId,
            atts,
          );
          if (sourceAttachmentIds.length !== atts.length) {
            throw new Error("Not every document was saved.");
          }
        } catch (error) {
          const failedMessages = updateMessages((current) => [
            ...current,
            {
              role: "user",
              content: visibleText,
              attachments: atts.map((attachment) => ({
                name: attachment.name,
                kind: attachment.kind,
              })),
            },
            {
              role: "assistant",
              content: `⚠️ I couldn't save these documents. ${
                error instanceof Error ? error.message : "Please try again."
              }`,
            },
          ]);
          void queueSnapshot(
            activeSessionId,
            failedMessages,
            historyRef.current,
          );
          setStreamingValue(false);
          return false;
        }
      }
      const plan: ProposalPlan | undefined =
        options?.plan ??
        (atts.length > 0
          ? {
              version: 1,
              sourceNames: atts.map((attachment) => attachment.name),
              sourceAttachments: atts,
              ...(sourceAttachmentIds.length
                ? { sourceAttachmentIds }
                : {}),
            }
          : undefined);
      // The transcript re-sent on every future turn must carry non-empty text
      // for every message — an attachment-only turn still needs a stand-in
      // line here (the attachment itself only rides along on THIS request).
      const historyText = apiText || "(sent a file)";
      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: historyText } satisfies ChiefHistoryMessage,
      ].slice(-40);
      const optimisticMessages = updateMessages((m) => [
        ...m.slice(-198),
        {
          role: "user",
          content: visibleText,
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
      void queueSnapshot(
        activeSessionId,
        optimisticMessages,
        historyRef.current,
      );

      let succeeded = true;
      let receivedPlan = false;
      try {
        const res = await fetch("/api/chief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyRef.current,
            page: effectivePage,
            sessionId: activeSessionId,
            ...(plan?.sourceAttachmentIds?.length
              ? { attachmentIds: plan.sourceAttachmentIds }
              : atts.length
                ? { attachments: atts }
                : {}),
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
          updateMessages((msgs) => {
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
          {
            role: "assistant",
            content: finalText || "(cards below)",
          } satisfies ChiefHistoryMessage,
        ].slice(-40);

        if (cut !== -1) {
          try {
            const blob = JSON.parse(buffer.slice(cut + 1)) as {
              proposals?: ProposedAction[];
            };
            const items: ProposalItem[] = (blob.proposals ?? []).map((p) => ({
              uid: crypto.randomUUID(),
              proposal: p,
              status: "proposed",
            }));
            receivedPlan = items.length > 0;
            if (items.length > 0) {
              updateMessages((msgs) => {
                const out = [...msgs];
                const last = out[out.length - 1];
                if (last?.role === "assistant") {
                  out[out.length - 1] = {
                    ...last,
                    proposals: items,
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
        updateMessages((msgs) => {
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
        setStreamingValue(false);
        void queueSnapshot(
          activeSessionId,
          messagesRef.current,
          historyRef.current,
        );
      }
      return succeeded;
    },
    [
      effectivePage,
      ensureSession,
      queueSnapshot,
      setStreamingValue,
      updateMessages,
    ],
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
      if (
        !request ||
        replaceable.length === 0 ||
        streamingRef.current ||
        operationRef.current ||
        transitionRef.current
      ) {
        return;
      }
      const ids = new Set(replaceable.map((item) => item.uid));
      const previous = new Map(
        replaceable.map((item) => [item.uid, item.status] as const),
      );
      const superseded = updateMessages((msgs) =>
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
      void queueSnapshot(
        sessionIdRef.current,
        superseded,
        historyRef.current,
      );

      const rollBack = () => {
        const rolledBack = updateMessages((msgs) =>
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
        void queueSnapshot(
          sessionIdRef.current,
          rolledBack,
          historyRef.current,
        );
      };

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

      const sourceAttachments = plan.sourceAttachments ?? [];
      if (
        sourceAttachments.length === 0 &&
        (plan.sourceAttachmentIds?.length ?? 0) === 0
      ) {
        rollBack();
        return;
      }

      const succeeded = await send(request, sourceAttachments, {
        apiText,
        showAttachments: false,
        plan: {
          version: plan.version + 1,
          sourceNames: plan.sourceNames,
          sourceAttachments,
          sourceAttachmentIds: plan.sourceAttachmentIds,
        },
      });
      if (!succeeded) rollBack();
    },
    [queueSnapshot, send, updateMessages],
  );

  const runIntent = useCallback(
    async (intent: ChiefIntent): Promise<void> => {
      const resolved = resolveChiefIntent(intent);
      if (!(await newChat(intent.id, resolved.title))) return;
      setOpen(true);
      await send(resolved.displayText, undefined, {
        apiText: resolved.apiText,
      });
    },
    [newChat, send],
  );

  const uploadDocuments = useCallback(
    async (attachments: ChatAttachment[]): Promise<void> => {
      if (
        attachments.length === 0 ||
        !(await newChat("document.review", DOCUMENT_REVIEW_INTENT.title))
      ) {
        return;
      }
      setOpen(true);
      await send(DOCUMENT_REVIEW_INTENT.displayText, attachments, {
        apiText: DOCUMENT_REVIEW_INTENT.apiText,
      });
    },
    [newChat, send],
  );

  const approve = useCallback(
    async (uid: string, mergeTargetId?: string) => {
      const item = findProposal(uid);
      if (
        !item ||
        streamingRef.current ||
        operationRef.current ||
        (item.status !== "proposed" && item.status !== "error")
      ) {
        return;
      }
      operationRef.current = true;
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
      } finally {
        operationRef.current = false;
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
      if (
        !item ||
        streamingRef.current ||
        operationRef.current ||
        item.status !== "done" ||
        !item.undo
      ) {
        return;
      }
      operationRef.current = true;
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
      } finally {
        operationRef.current = false;
      }
    },
    [findProposal, patchProposal],
  );

  const clear = useCallback(() => {
    void newChat();
  }, [newChat]);

  const pendingCount = useMemo(() => pendingProposalCount(messages), [messages]);

  const value = useMemo<ChiefContextValue>(
    () => ({
      open,
      setOpen,
      page,
      setPage,
      sessionId,
      recentSessions,
      sessionsLoading,
      messages,
      streaming,
      pendingCount,
      refreshRecentSessions,
      newChat,
      switchSession,
      runIntent,
      uploadDocuments,
      send,
      revisePlan,
      approve,
      dismiss,
      restore,
      undo,
      clear,
    }),
    [
      open,
      page,
      sessionId,
      recentSessions,
      sessionsLoading,
      messages,
      streaming,
      pendingCount,
      refreshRecentSessions,
      newChat,
      switchSession,
      runIntent,
      uploadDocuments,
      send,
      revisePlan,
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
