import Anthropic from "@anthropic-ai/sdk";
import { resolveAi } from "@/lib/ai";

// Classify-on-save: when a new fact is created without an explicit area, file it
// into the user's EXISTING locked areas (the AI-derived taxonomy). This keeps the
// hierarchy self-maintaining — new knowledge lands in the right area instead of
// piling up in "Unfiled". Best-effort by design: any failure (no key, bad JSON,
// no good fit) leaves the fact Unfiled rather than blocking the save.

export type AreaHint = {
  name: string;
  description?: string | null;
  topics: string[];
};

const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM = [
  "You file a new knowledge-base fact into the user's EXISTING areas.",
  "Pick the single best-fitting area from the provided list, and a short topic",
  "within it — reuse one of that area's existing topics when one fits, otherwise",
  "a concise new topic (1-3 words). If NO listed area is a genuinely good fit,",
  "return null for area; never force a poor match.",
  'Respond with ONLY a JSON object (no markdown): {"area": string|null, "topic": string|null}.',
  "The area, when non-null, MUST be copied exactly from the list.",
].join("\n");

/**
 * Returns the chosen {area, topic} (area guaranteed to be one of the provided
 * names) or null when nothing fits / the model is unavailable.
 */
export async function classifyArea(input: {
  areas: AreaHint[];
  title: string;
  body: string;
  tags?: string[];
}): Promise<{ area: string; topic: string | null } | null> {
  if (input.areas.length === 0) return null;
  const ai = await resolveAi({ model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL });
  if (!ai) return null;
  const model = ai.model;

  const areaList = input.areas
    .map(
      (a) =>
        `- ${a.name}${a.description ? `: ${a.description}` : ""}${
          a.topics.length ? ` (topics: ${a.topics.join(", ")})` : ""
        }`,
    )
    .join("\n");

  const prompt = [
    "AREAS:",
    areaList,
    "",
    "NEW FACT:",
    `Title: ${input.title}`,
    input.tags?.length ? `Tags: ${input.tags.join(", ")}` : "",
    "Body:",
    input.body.slice(0, 1200),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = ai.client;
    const msg = await client.messages.create({
      model,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { area?: string | null; topic?: string | null };

    const area = (parsed.area ?? "").toString().trim();
    if (!area) return null;
    // Only accept an area the user actually has (case-insensitive), so a
    // hallucinated name can't create a stray bucket.
    const match = input.areas.find((a) => a.name.toLowerCase() === area.toLowerCase());
    if (!match) return null;
    return { area: match.name, topic: (parsed.topic ?? "").toString().trim() || null };
  } catch {
    return null;
  }
}
