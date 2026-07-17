import assert from "node:assert/strict";
import test from "node:test";
import {
  clipInline,
  taskLine,
  renderTaskList,
  renderTaskDetail,
  matchTasks,
  resolveProjectRef,
  renderProjectListItem,
} from "../lib/chief-read-format.ts";

// --- fixtures ---------------------------------------------------------------
const task = (over = {}) => ({
  id: "t1",
  title: "Task one",
  notes: null,
  status: "open",
  waiting_on: null,
  waiting_since: null,
  due_at: null,
  project_id: null,
  sort: 0,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

const project = (over = {}) => ({
  id: "p1",
  name: "Website relaunch",
  status: "active",
  summary: null,
  owner: null,
  sort: 0,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  state: null,
  ...over,
});

// --- clipInline -------------------------------------------------------------
test("clipInline collapses whitespace, clips length, and nulls empties", () => {
  assert.equal(clipInline("  hello \n  world  ", 100), "hello world");
  assert.equal(clipInline("abcdef", 3), "abc…");
  assert.equal(clipInline("", 10), null);
  assert.equal(clipInline(null, 10), null);
});

// --- taskLine (compact) -----------------------------------------------------
test("taskLine is compact: status/waiting-on/due/project/id, never notes", () => {
  const names = new Map([["p9", "HomeJab"]]);
  const line = taskLine(
    task({
      id: "t2",
      title: "Reply to Ivan",
      status: "waiting",
      waiting_on: "Ivan",
      due_at: "2026-07-15T00:00:00Z",
      project_id: "p9",
      notes: "SECRET NOTES that must not leak into a compact line",
    }),
    names,
  );
  assert.equal(
    line,
    "- Reply to Ivan [waiting, waiting on Ivan, due 2026-07-15] (project: HomeJab) (id: t2)",
  );
  assert.ok(!line.includes("SECRET NOTES"));
});

test("taskLine honors indent and showProject options", () => {
  const names = new Map([["p9", "HomeJab"]]);
  const line = taskLine(task({ project_id: "p9" }), names, {
    indent: true,
    showProject: false,
  });
  assert.ok(line.startsWith("   - "));
  assert.ok(!line.includes("project:"));
});

// --- renderTaskList (compact) ----------------------------------------------
test("renderTaskList lists compactly with a count header and no notes", () => {
  const out = renderTaskList([
    task({ id: "a", title: "Alpha", notes: "hidden alpha notes" }),
    task({ id: "b", title: "Beta", status: "done" }),
  ]);
  assert.ok(out.includes("2 task(s)"));
  assert.ok(out.includes("incl. 1 done"));
  assert.ok(out.includes("Alpha"));
  assert.ok(out.includes("Beta"));
  assert.ok(!out.includes("hidden alpha notes"));
});

test("renderTaskList handles the empty case", () => {
  assert.equal(renderTaskList([]), "No matching tasks.");
});

// --- renderTaskDetail (full) ------------------------------------------------
test("renderTaskDetail includes full notes and waiting metadata", () => {
  const out = renderTaskDetail(
    task({
      id: "t3",
      title: "Follow up",
      status: "waiting",
      waiting_on: "Legal",
      waiting_since: "2026-07-02T00:00:00Z",
      notes: "the full multi-line\nnotes body",
    }),
    "HomeJab",
  );
  assert.ok(out.includes("id: t3"));
  assert.ok(out.includes("waiting on Legal"));
  assert.ok(out.includes("project: HomeJab"));
  assert.ok(out.includes("waiting since: 2026-07-02"));
  assert.ok(out.includes("notes:"));
  assert.ok(out.includes("the full multi-line\nnotes body"));
});

// --- matchTasks -------------------------------------------------------------
test("matchTasks is case-insensitive across title/notes/waiting-on", () => {
  const tasks = [
    task({ id: "1", title: "Email the LEAD spreadsheet" }),
    task({ id: "2", title: "Something else", notes: "mentions the lead in notes" }),
    task({ id: "3", title: "Waiting", status: "waiting", waiting_on: "Lead vendor" }),
    task({ id: "4", title: "Unrelated" }),
  ];
  const ids = matchTasks(tasks, "lead").map((t) => t.id).sort();
  assert.deepEqual(ids, ["1", "2", "3"]);
});

test("matchTasks excludes done unless includeDone, and empty query yields none", () => {
  const tasks = [
    task({ id: "1", title: "ship it", status: "done" }),
    task({ id: "2", title: "ship it", status: "open" }),
  ];
  assert.deepEqual(matchTasks(tasks, "ship").map((t) => t.id), ["2"]);
  assert.deepEqual(
    matchTasks(tasks, "ship", true).map((t) => t.id).sort(),
    ["1", "2"],
  );
  assert.deepEqual(matchTasks(tasks, "   "), []);
});

// --- resolveProjectRef ------------------------------------------------------
test("resolveProjectRef resolves by id, exact name, and unique substring", () => {
  const projects = [
    project({ id: "p1", name: "Website relaunch" }),
    project({ id: "p2", name: "HomeJab leads" }),
  ];
  assert.equal(resolveProjectRef(projects, "p2").kind, "found");
  assert.equal(resolveProjectRef(projects, "p2").project.id, "p2");
  // exact name, case-insensitive
  assert.equal(resolveProjectRef(projects, "website relaunch").project.id, "p1");
  // unique substring
  assert.equal(resolveProjectRef(projects, "leads").project.id, "p2");
});

test("resolveProjectRef reports ambiguous and not-found", () => {
  const projects = [
    project({ id: "p1", name: "Q3 launch" }),
    project({ id: "p2", name: "Q3 launch" }),
    project({ id: "p3", name: "Other" }),
  ];
  const amb = resolveProjectRef(projects, "Q3 launch");
  assert.equal(amb.kind, "ambiguous");
  assert.equal(amb.matches.length, 2);

  assert.equal(resolveProjectRef(projects, "nope").kind, "not_found");
  assert.equal(resolveProjectRef(projects, "").kind, "not_found");
});

// --- renderProjectListItem (compact) ---------------------------------------
test("renderProjectListItem is compact: clipped state, next action, open count", () => {
  const out = renderProjectListItem(
    project({
      id: "p1",
      name: "Website relaunch",
      owner: "Jim",
      summary: "New marketing site",
      state: {
        current_state: "x".repeat(500),
        waiting_on: "the design team",
        last_verified_at: null,
      },
    }),
    0,
    { nextAction: "Draft the hero copy (id: t7)", openCount: 3 },
  );
  assert.ok(out.includes("1. Website relaunch [owner/DRI: Jim] — New marketing site"));
  assert.ok(out.includes("id: p1"));
  assert.ok(out.includes("next action: Draft the hero copy (id: t7)"));
  assert.ok(out.includes("open tasks: 3"));
  assert.ok(out.includes("waiting on: the design team"));
  // state is clipped to 300 chars + ellipsis, not the full 500
  assert.ok(out.includes("…"));
  assert.ok(!out.includes("x".repeat(400)));
});
