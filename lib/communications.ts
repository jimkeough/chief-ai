// The append-only communications log: everything in/out across channels, one
// row per message. Chief chat turns land here with channel='chief'; email
// arrives in Phase 4. RLS grants select+insert only — nothing in the app can
// rewrite history (see the foundation migration).

import { createClient } from "@/lib/supabase/server";

export type CommChannel = "email" | "chief" | "sms" | (string & {});
export type CommDirection = "in" | "out";

export type Communication = {
  id: string;
  channel: CommChannel;
  direction: CommDirection;
  contact_id: string | null;
  external_thread_id: string | null;
  subject: string | null;
  body_text: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

const COLUMNS =
  "id, channel, direction, contact_id, external_thread_id, subject, body_text, occurred_at, metadata";

export type RecordCommunicationInput = {
  channel: CommChannel;
  direction: CommDirection;
  contactId?: string | null;
  externalThreadId?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

export async function recordCommunication(
  input: RecordCommunicationInput,
): Promise<Communication> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .insert({
      channel: input.channel,
      direction: input.direction,
      contact_id: input.contactId ?? null,
      external_thread_id: input.externalThreadId ?? null,
      subject: input.subject ?? null,
      body_text: input.bodyText ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      metadata: input.metadata ?? {},
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Communication;
}

export async function listCommunications(
  opts: { channel?: CommChannel; contactId?: string; limit?: number } = {},
): Promise<Communication[]> {
  const supabase = await createClient();
  let query = supabase
    .from("communications")
    .select(COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.channel) query = query.eq("channel", opts.channel);
  if (opts.contactId) query = query.eq("contact_id", opts.contactId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Communication[];
}

/** True when a specific Gmail message was already recorded — the inbox view
 *  logs each inbound message once, keyed by metadata.gmail_message_id. */
export async function hasEmailCommunication(messageId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .select("id")
    .contains("metadata", { gmail_message_id: messageId })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * Has this contact sent anything since `sinceIso`? Drives the Waiting-on strip:
 * green = they moved (an inbound message after the task entered waiting),
 * gray = quiet, copper = quiet past the aging threshold.
 */
export async function hasInboundSince(
  contactId: string,
  sinceIso: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("communications")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("direction", "in")
    .gt("occurred_at", sinceIso);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
