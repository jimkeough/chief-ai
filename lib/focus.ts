// The Home focus view's brain. The Top-N is simply the user's OPEN tasks in
// their manual order (the `sort` they drag) — the order IS the priority. There
// is no computed score: no priority/impact/effort weighting, no due-date
// re-ranking. Due dates and waiting state inform Chief's narrative and the
// waiting strip, but never silently reorder the list.
//
// The same pass produces the Waiting-on strip: every `waiting` task, labeled by
// its free-text `waiting_on`. For legacy tasks still linked to a contact
// (`waiting_on_contact_id`), the strip additionally cross-references the
// append-only communications log — green = they moved (inbound since
// waiting_since), gray = quiet, copper = quiet past the tunable aging threshold.

import { listTasks, sortByManualOrder, type Task } from "@/lib/tasks";
import { listContacts, type Contact } from "@/lib/contacts";
import { hasInboundSince } from "@/lib/communications";
import { getNumericSetting } from "@/lib/settings";
import { daysSince } from "@/lib/format";

export type RankedTask = {
  task: Task;
};

export type WaitingState = "moved" | "quiet" | "aging";

export type WaitingRow = {
  taskId: string;
  /** Who/what we're waiting on: the free-text waiting_on, else a legacy linked
   *  contact's name, else "—". */
  who: string;
  /** What for (the task title). */
  what: string;
  state: WaitingState;
  /** Days since the task entered waiting. */
  days: number;
  /** First known email for a legacy linked contact; absent otherwise. */
  contactEmail: string | null;
  /** A quiet/aging linked contact with an email can be followed up. */
  canFollowUp: boolean;
};

export type FocusSnapshot = {
  top: RankedTask[];
  waiting: WaitingRow[];
  openCount: number;
};

/** Compute the whole Home focus picture in one pass. */
export async function buildFocusSnapshot(): Promise<FocusSnapshot> {
  const [tasks, contacts, topCount, agingDays] = await Promise.all([
    listTasks(),
    listContacts().catch(() => [] as Contact[]),
    getNumericSetting("focus.top_count"),
    getNumericSetting("waiting.aging_days"),
  ]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const open = tasks.filter((t) => t.status !== "done");

  // Waiting-on strip: one row per waiting task. `who` comes from the free-text
  // waiting_on; a legacy contact link (if still set) adds reply detection.
  const waiting: WaitingRow[] = [];
  for (const t of open.filter((t) => t.status === "waiting")) {
    const contact = t.waiting_on_contact_id
      ? contactById.get(t.waiting_on_contact_id)
      : undefined;
    const since = t.waiting_since ?? t.updated_at;
    let moved = false;
    if (contact && since) {
      moved = await hasInboundSince(contact.id, since).catch(() => false);
    }
    const days = daysSince(since) ?? 0;
    const contactEmail = contact?.emails[0] ?? null;
    waiting.push({
      taskId: t.id,
      who: t.waiting_on ?? contact?.name ?? "—",
      what: t.title,
      state: moved ? "moved" : days >= agingDays ? "aging" : "quiet",
      days,
      contactEmail,
      canFollowUp: !moved && Boolean(contactEmail),
    });
  }
  // Moved first (they need action), then oldest quiet.
  waiting.sort(
    (a, b) =>
      Number(b.state === "moved") - Number(a.state === "moved") ||
      b.days - a.days,
  );

  // Top-N: the actionable (open) tasks in the user's manual order. Waiting tasks
  // stay out (they're blocked on someone else); done tasks never appear.
  const top: RankedTask[] = sortByManualOrder(
    open.filter((t) => t.status === "open"),
  )
    .slice(0, Math.max(1, topCount || 3))
    .map((task) => ({ task }));

  return { top, waiting, openCount: open.length };
}
