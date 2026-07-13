import assert from "node:assert/strict";
import test from "node:test";
import {
  documentEntityTool,
  normalizeDocumentEntityInput,
  parseDocumentEntities,
} from "../lib/document-import/contract.ts";
import { buildDocumentChunks } from "../lib/document-import/chunks.ts";

const expected = {
  sourceName: "tasks.csv",
  sourceIds: ["tasks.csv#row-2"],
  sourceIdPrefix: "tasks.csv#",
  strictCount: true,
  entityKind: "task",
};

const task = {
  sourceId: "tasks.csv#row-2",
  sourceName: "tasks.csv",
  excerpt: "Ship the importer",
  kind: "task",
  title: "Ship the importer",
};

test("uses a fallback-model-compatible entity schema", () => {
  const schema = documentEntityTool().input_schema;
  const items = schema.properties.entities.items;
  assert.equal(items.type, "object");
  assert.equal("oneOf" in items, false);
  assert.deepEqual(schema.required, ["entities"]);
});

test("normalizes common gateway tool argument wrappers", () => {
  assert.deepEqual(normalizeDocumentEntityInput([task]), { entities: [task] });
  assert.deepEqual(normalizeDocumentEntityInput({ records: [task] }), {
    records: [task],
    entities: [task],
  });
  assert.deepEqual(
    normalizeDocumentEntityInput(JSON.stringify({ entities: [task] })),
    { entities: [task] },
  );
  assert.deepEqual(parseDocumentEntities([task], expected), {
    entities: [task],
    errors: [],
  });
});

test("still fails closed when no entity collection exists", () => {
  assert.deepEqual(parseDocumentEntities({}, expected), {
    errors: ["The extraction response needs an entities array."],
  });
});

test("stamps server-known source names over model output", () => {
  const mislabeled = { ...task, sourceName: "HomeJab product" };
  assert.deepEqual(parseDocumentEntities({ entities: [mislabeled] }, expected), {
    entities: [task],
    errors: [],
  });
  const { sourceName: _sourceName, ...missingSourceName } = task;
  assert.deepEqual(
    parseDocumentEntities({ entities: [missingSourceName] }, expected),
    {
      entities: [task],
      errors: [],
    },
  );
});

test("splits multiline CSV task rows into bounded strict batches", () => {
  const rows = [
    "Task,Status,Notes,Brand,Priority",
    'First task,In progress,"First line',
    'second line",HomeJab,P1 - High',
    "Second task,Not started,,HomeJab,P2 - Medium",
    "Third task,Not started,,HomeJab,P3 - Low",
    "Fourth task,Not started,,HomeJab,P3 - Low",
    "Fifth task,Not started,,HomeJab,P4 - Backlog",
    "Sixth task,Not started,,HomeJab,P4 - Backlog",
  ].join("\n");
  const chunks = buildDocumentChunks([
    { kind: "text", name: "tasks.csv", text: rows },
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].entityKind, "task");
  assert.equal(chunks[0].strictCount, true);
  assert.equal(chunks[0].sourceIds.length, 5);
  assert.deepEqual(chunks[1].sourceIds, ["tasks.csv#row-7"]);
  assert.match(chunks[0].text ?? "", /First line\nsecond line/);
});

test("splits plain-text bullet lists into bounded source records", () => {
  const text = [
    "housepro:",
    "- Audit the report.",
    "- Review delays.",
    "- Check the landing page.",
    "",
    "homejab:",
    "- Test the mobile app.",
    "- Reply in Jira.",
    "- Check pricing.",
  ].join("\n");
  const chunks = buildDocumentChunks([
    { kind: "text", name: "todo.txt", text },
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].strictCount, true);
  assert.equal(chunks[0].sourceIds.length, 5);
  assert.deepEqual(chunks[1].sourceIds, ["todo.txt#item-6"]);
  assert.match(chunks[0].text ?? "", /Workstream: housepro/);
  assert.match(chunks[1].text ?? "", /Workstream: homejab/);
});
