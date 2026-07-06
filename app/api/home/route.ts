// GET /api/home — everything the Home focus view shows: the deterministic
// Top-N + Waiting-on strip from lib/focus.ts, and Chief's short narrative on
// top. The ranking is code; Chief only writes the story — it never reorders.
// The narrative is cached per (day + focus fingerprint) so reloads are free
// until something actually changes.

import Anthropic from "@anthropic-ai/sdk";
import { getAuthed, unauthorized } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { resolveAi } from "@/lib/ai";
import { buildFocusSnapshot } from "@/lib/focus";
import { listProjectsWithState } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = [
  "You are Chief, the user's chief of staff, writing the ONE short line at the top of their morning view.",
  "You are given today's ranked top tasks (the order is fixed — never argue with it), the waiting-on strip, and project headlines.",
  "Write 1–2 sentences, max ~28 words total: what today is about, plus the single most useful signal (someone replied / something's aging / a due date).",
  "Wrap the ONE phrase that matters most in **double asterisks**. Plain, direct, no greeting, no markdown beyond that one bold.",
].join("\n");

// Per-instance cache: the narrative for a given day + focus state.
const CACHE = new Map<string, string>();

export async function GET() {
  if (!(await getAuthed())) return unauthorized();

  const snapshot = await buildFocusSnapshot();

  // Fingerprint what the narrative depends on.
  const day = new Date().toISOString().slice(0, 10);
  const fingerprint = JSON.stringify([
    day,
    snapshot.top.map((r) => [r.task.id, r.unblocked]),
    snapshot.waiting.map((w) => [w.taskId, w.state]),
  ]);

  let narrative = CACHE.get(fingerprint) ?? "";
  if (!narrative && snapshot.top.length > 0) {
    try {
      const projects = await listProjectsWithState().catch(() => []);
      const projectLines = projects
        .filter((p) => p.status === "active")
        .slice(0, 8)
        .map((p) => `- ${p.name}: ${p.state?.current_state ?? "(no state)"}`)
        .join("\n");
      const settings = await getAppSettings();
      const ai = await resolveAi({ settings });
      if (!ai) throw new Error("no AI provider configured");
      const { client, model } = ai;
      const msg = await client.messages.create({
        model,
        max_tokens: 120,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              "TOP TASKS (fixed order):",
              ...snapshot.top.map(
                (r, i) =>
                  `${i + 1}. ${r.task.title}${r.unblocked ? " (just unblocked — they replied)" : ""}${
                    r.task.due_at ? ` (due ${r.task.due_at.slice(0, 10)})` : ""
                  }`,
              ),
              "",
              "WAITING ON:",
              ...(snapshot.waiting.length
                ? snapshot.waiting.map(
                    (w) => `- ${w.who} — ${w.what} [${w.state}, ${w.days}d]`,
                  )
                : ["(nothing)"]),
              "",
              "PROJECTS:",
              projectLines || "(none)",
            ].join("\n"),
          },
        ],
      });
      narrative = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (narrative) CACHE.set(fingerprint, narrative);
    } catch {
      narrative = "";
    }
  }

  return Response.json({
    narrative,
    top: snapshot.top.map((r) => ({
      id: r.task.id,
      title: r.task.title,
      priority: r.task.priority,
      due_at: r.task.due_at,
      project_id: r.task.project_id,
      unblocked: r.unblocked,
      effortNote: r.effortNote,
    })),
    waiting: snapshot.waiting,
    openCount: snapshot.openCount,
  });
}
