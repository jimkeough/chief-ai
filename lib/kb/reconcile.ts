// The EXPENSIVE half of KB synthesis: merge a new note into an existing entry,
// producing one updated, deduplicated entry (newer facts win, nothing still
// valid is lost). This is an isolated LLM call — it sees only the existing entry
// and the new note, NOT any chat transcript or conversation — so it stays cheap
// regardless of which surface triggers it.

import Anthropic from "@anthropic-ai/sdk";
import { resolveAi } from "@/lib/ai";
import { getKbDocument } from "./store";

const DEFAULT_MODEL = "claude-opus-4-8";

const RECONCILE_SYSTEM = [
  "You maintain a personal knowledge base. Merge the NEW note into the EXISTING entry,",
  "producing ONE updated, deduplicated entry.",
  "Rules:",
  "- When facts conflict (a changed price, date, status, decision), keep the NEWER value from the new note and remove the outdated one.",
  "- Keep all still-valid facts from the existing entry; don't lose information that isn't superseded.",
  "- Stay concise and atomic (markdown bullets). Never duplicate a fact.",
  "- Keep a clear title and up to 5 lowercase single-word tags.",
  "",
  "Respond with ONLY a JSON object (no markdown, no code fence) of this exact shape:",
  '{"title": string, "body": string, "tags": string[], "change_summary": string}',
  "change_summary: ONE short sentence describing what changed, written for the user to confirm the merge.",
].join("\n");

export type ReconciledNote = {
  title: string;
  body: string;
  tags: string[];
  changeSummary: string;
};

type RawReconciled = {
  title: string;
  body: string;
  tags: string[];
  change_summary: string;
};

function parseJson(text: string): RawReconciled | null {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as RawReconciled;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text);
  if (direct) return direct;
  const m = text.match(/\{[\s\S]*\}/);
  return m ? tryParse(m[0]) : null;
}

/** Thrown for caller-actionable failures so routes can map to status codes. */
export class ReconcileError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Reconcile a new note into the existing entry `existingId`. Returns the merged
 * note (title/body/tags) plus a one-line change summary for the user to confirm.
 * Throws ReconcileError (with an HTTP-ish status) when the entry is missing,
 * Anthropic is unconfigured, or the model output can't be parsed.
 */
export async function reconcileKbEntry(
  existingId: string,
  note: { title?: string; body: string; tags?: string[] },
): Promise<ReconciledNote> {
  const ai = await resolveAi({ model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL });
  if (!ai) {
    throw new ReconcileError("No AI provider is configured.", 500);
  }
  const model = ai.model;

  const existing = await getKbDocument(existingId);
  if (!existing) {
    throw new ReconcileError("Existing entry not found.", 404);
  }

  const prompt = [
    `EXISTING ENTRY:`,
    `Title: ${existing.title}`,
    `Tags: ${(existing.tags || []).join(", ")}`,
    `Body:`,
    existing.body,
    ``,
    `NEW NOTE:`,
    `Title: ${note.title ?? ""}`,
    `Body:`,
    note.body,
  ].join("\n");

  const client = ai.client;
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system: RECONCILE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const merged = parseJson(text);
  if (!merged) {
    throw new ReconcileError("Couldn't reconcile the entries.", 502);
  }

  return {
    title: merged.title ?? existing.title,
    body: merged.body ?? existing.body,
    tags: Array.isArray(merged.tags) ? merged.tags : existing.tags || [],
    changeSummary: merged.change_summary ?? "",
  };
}
