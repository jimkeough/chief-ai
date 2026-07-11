import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ChiefHistoryMessage,
  ChiefSessionRecord,
  ChiefSessionSummary,
} from "@/lib/chief-session-types";
import type { ChiefIntentId } from "@/lib/chief-intents";

const SUMMARY_COLUMNS =
  "id, title, intent, page_label, pending_count, created_at, updated_at";
const RECORD_COLUMNS = `${SUMMARY_COLUMNS}, messages, history`;

export async function listChiefSessions(
  limit = 20,
): Promise<ChiefSessionSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chief_sessions")
    .select(SUMMARY_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw new Error(error.message);
  return (data ?? []) as ChiefSessionSummary[];
}

export async function getChiefSession<TMessage = unknown>(
  id: string,
): Promise<ChiefSessionRecord<TMessage> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chief_sessions")
    .select(RECORD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ChiefSessionRecord<TMessage> | null;
}

export async function createChiefSession(input: {
  intent: ChiefIntentId;
  title?: string;
  pageLabel?: string | null;
}): Promise<ChiefSessionRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chief_sessions")
    .insert({
      intent: input.intent,
      title: input.title?.trim().slice(0, 80) || "New chat",
      page_label: input.pageLabel?.trim().slice(0, 120) || null,
    })
    .select(RECORD_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ChiefSessionRecord;
}

export async function updateChiefSession(
  id: string,
  input: {
    title: string;
    messages: unknown[];
    history: ChiefHistoryMessage[];
    pendingCount: number;
  },
): Promise<ChiefSessionSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chief_sessions")
    .update({
      title: input.title.trim().slice(0, 80) || "New chat",
      messages: input.messages,
      history: input.history,
      pending_count: Math.max(0, Math.floor(input.pendingCount)),
    })
    .eq("id", id)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ChiefSessionSummary | null;
}
