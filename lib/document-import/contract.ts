import type Anthropic from "@anthropic-ai/sdk";
import type { WriteActionKey } from "@/lib/actions";

export const DOCUMENT_ENTITY_TOOL_NAME = "submit_document_entities";

/** Exhaustive drift gate: every write action must be intentionally available
 * to document compilation or explicitly excluded. */
export const DOCUMENT_IMPORT_ACTION_POLICY = {
  create_task: "compile",
  update_task: "compile",
  save_kb_fact: "compile",
  save_instruction: "compile",
  save_contact: "compile",
  create_note: "compile",
  create_project: "compile",
  update_project: "compile",
  update_project_state: "compile",
  archive_email: "exclude",
  reply_email: "exclude",
} as const satisfies Record<WriteActionKey, "compile" | "exclude">;

export const DOCUMENT_ENTITY_KINDS = [
  "project",
  "task",
  "contact",
  "memory",
  "instruction",
  "note",
] as const;
export type DocumentEntityKind = (typeof DOCUMENT_ENTITY_KINDS)[number];

type SourceEvidence = {
  sourceId: string;
  sourceName: string;
  locator?: string;
  excerpt: string;
};

export type ProjectEntity = SourceEvidence & {
  kind: "project";
  name: string;
  summary?: string;
  status?: "active" | "paused" | "done" | "archived";
  owner?: string;
  currentState?: string;
  waitingOn?: string;
};

export type TaskEntity = SourceEvidence & {
  kind: "task";
  title: string;
  notes?: string;
  status?: "open" | "waiting" | "done";
  waitingOn?: string;
  dueAt?: string;
  projectName?: string;
};

export type ContactEntity = SourceEvidence & {
  kind: "contact";
  name: string;
  email?: string;
  company?: string;
  notes: string;
};

export type MemoryEntity = SourceEvidence & {
  kind: "memory";
  title: string;
  body: string;
  tags?: string[];
};

export type InstructionEntity = SourceEvidence & {
  kind: "instruction";
  title: string;
  body: string;
};

export type NoteEntity = SourceEvidence & {
  kind: "note";
  title: string;
  body: string;
  pinned?: boolean;
};

export type DocumentEntity =
  | ProjectEntity
  | TaskEntity
  | ContactEntity
  | MemoryEntity
  | InstructionEntity
  | NoteEntity;

export type DocumentImportSummary = {
  sourceCount: number;
  recordCount: number;
  proposalCount: number;
  noChangeCount: number;
  ambiguousCount: number;
  ignoredCount: number;
  byKind: Partial<Record<DocumentEntityKind, number>>;
};

const string = { type: "string" };
const sourceProperties = {
  sourceId: {
    type: "string",
    description: "Stable ID supplied by the source chunk.",
  },
  sourceName: { type: "string" },
  locator: { type: "string" },
  excerpt: {
    type: "string",
    description: "Short verbatim source evidence.",
  },
};

const entityProperties = {
  ...sourceProperties,
  kind: { type: "string", enum: DOCUMENT_ENTITY_KINDS },
  name: string,
  title: string,
  summary: string,
  status: {
    type: "string",
    // Project statuses (active/paused/done/archived) and task statuses
    // (open/waiting/done) share this field.
    enum: ["active", "paused", "done", "archived", "open", "waiting"],
  },
  owner: string,
  currentState: string,
  waitingOn: string,
  notes: string,
  dueAt: string,
  projectName: string,
  email: string,
  company: string,
  body: string,
  tags: { type: "array", items: string },
  pinned: { type: "boolean" },
};

export function documentEntityTool(): Anthropic.Tool {
  return {
    name: DOCUMENT_ENTITY_TOOL_NAME,
    description:
      "Extract only the entities present in this bounded source chunk. Preserve source wording and relationships. Do not reconcile against the workspace and do not produce database actions.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        entities: {
          type: "array",
          description:
            "Typed entities. Projects and contacts require name; tasks require title; memory, instruction, and note entities require title and body.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: entityProperties,
            required: ["sourceId", "excerpt", "kind"],
          },
        },
      },
      required: ["entities"],
    } as Anthropic.Tool["input_schema"],
  };
}

const ENUMS: Record<string, readonly string[]> = {
  kind: DOCUMENT_ENTITY_KINDS,
  status: ["active", "paused", "done", "archived", "open", "waiting"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Gateway fallback models occasionally serialize valid tool arguments or use
 * a records alias despite the forced schema. Normalize only known wrappers;
 * the validator below still rejects malformed or unsafe entity contents. */
export function normalizeDocumentEntityInput(raw: unknown): unknown {
  let normalized = raw;
  if (typeof normalized === "string") {
    try {
      normalized = JSON.parse(normalized);
    } catch {
      return raw;
    }
  }
  if (Array.isArray(normalized)) return { entities: normalized };
  if (!isObject(normalized) || Array.isArray(normalized.entities)) {
    return normalized;
  }
  if (Array.isArray(normalized.records)) {
    return { ...normalized, entities: normalized.records };
  }
  if (isObject(normalized.entity)) {
    return { ...normalized, entities: [normalized.entity] };
  }
  return normalized;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  errors: string[],
): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) {
    errors.push(`${key} is required.`);
    return "";
  }
  return field.trim();
}

/** Fail closed, but keep extraction validation deliberately small. The final
 * compiler still emits only registered write actions. */
export function parseDocumentEntities(
  raw: unknown,
  expected: {
    sourceName: string;
    sourceIds: string[];
    sourceIdPrefix: string;
    strictCount: boolean;
    entityKind?: DocumentEntityKind;
  },
): { entities?: DocumentEntity[]; errors: string[] } {
  const errors: string[] = [];
  raw = normalizeDocumentEntityInput(raw);
  if (!isObject(raw) || !Array.isArray(raw.entities)) {
    return { errors: ["The extraction response needs an entities array."] };
  }
  const allowedSourceIds = new Set(expected.sourceIds);
  const entities: DocumentEntity[] = [];
  for (const [index, candidate] of raw.entities.entries()) {
    if (!isObject(candidate)) {
      errors.push(`Entity ${index + 1} is not an object.`);
      continue;
    }
    const kind = candidate.kind;
    if (
      typeof kind !== "string" ||
      !DOCUMENT_ENTITY_KINDS.includes(kind as DocumentEntityKind)
    ) {
      errors.push(`Entity ${index + 1} has an invalid kind.`);
      continue;
    }
    if (expected.entityKind && kind !== expected.entityKind) {
      errors.push(`Entity ${index + 1} must be a ${expected.entityKind}.`);
    }
    const sourceId = requiredString(candidate, "sourceId", errors);
    if (
      expected.strictCount
        ? !allowedSourceIds.has(sourceId)
        : !sourceId.startsWith(`${expected.sourceIdPrefix}#`)
    ) {
      errors.push(`Entity ${index + 1} has an unknown sourceId.`);
    }
    requiredString(candidate, "excerpt", errors);

    for (const [field, allowed] of Object.entries(ENUMS)) {
      const fieldValue = candidate[field];
      if (
        fieldValue !== undefined &&
        !allowed?.includes(String(fieldValue))
      ) {
        errors.push(`Entity ${index + 1} has an invalid ${field}.`);
      }
    }
    const requiredByKind: Record<DocumentEntityKind, string[]> = {
      project: ["name"],
      task: ["title"],
      contact: ["name", "notes"],
      memory: ["title", "body"],
      instruction: ["title", "body"],
      note: ["title", "body"],
    };
    for (const field of requiredByKind[kind as DocumentEntityKind]) {
      requiredString(candidate, field, errors);
    }
    // The attachment name is request provenance, not semantic model output.
    // Stamp the server-known value so a model cannot mislabel or spoof it.
    entities.push({
      ...candidate,
      sourceName: expected.sourceName,
    } as DocumentEntity);
  }
  if (expected.strictCount && entities.length !== expected.sourceIds.length) {
    errors.push(
      `Expected ${expected.sourceIds.length} entities, received ${entities.length}.`,
    );
  }
  if (expected.strictCount) {
    const returnedIds = new Set(entities.map((entity) => entity.sourceId));
    for (const sourceId of expected.sourceIds) {
      if (!returnedIds.has(sourceId)) errors.push(`Missing sourceId ${sourceId}.`);
    }
  }
  return errors.length ? { errors } : { entities, errors: [] };
}
