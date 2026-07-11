import type { ChiefIntentId } from "@/lib/chief-intents";

export type ChiefHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChiefSessionSummary = {
  id: string;
  title: string;
  intent: ChiefIntentId;
  page_label: string | null;
  pending_count: number;
  created_at: string;
  updated_at: string;
};

export type ChiefSessionRecord<TMessage = unknown> = ChiefSessionSummary & {
  messages: TMessage[];
  history: ChiefHistoryMessage[];
};
