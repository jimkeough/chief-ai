import {
  toProposedAction,
  type ProposedAction,
  type WriteActionKey,
} from "@/lib/actions";
import type {
  DocumentEntity,
  DocumentImportSummary,
  ProjectEntity,
  TaskEntity,
} from "@/lib/document-import/contract";
import { DOCUMENT_IMPORT_ACTION_POLICY } from "@/lib/document-import/contract";
import type { ProjectWithState } from "@/lib/projects";
import type { Task } from "@/lib/tasks";

export type DocumentCompileContext = {
  projects: ProjectWithState[];
  tasks: Task[];
};

const normalized = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? "";
const optional = (value: string | undefined) => {
  const clean = value?.trim();
  return clean || undefined;
};

function source(entity: DocumentEntity): NonNullable<ProposedAction["source"]> {
  return {
    sourceId: entity.sourceId,
    name: entity.sourceName,
    ...(entity.locator ? { locator: entity.locator } : {}),
    excerpt: entity.excerpt,
  };
}

function proposal(
  key: WriteActionKey,
  args: Record<string, unknown>,
  entity: DocumentEntity,
): ProposedAction {
  if (DOCUMENT_IMPORT_ACTION_POLICY[key] !== "compile") {
    throw new Error(`${key} is excluded from document imports.`);
  }
  const compiled = toProposedAction(key, args);
  if (!compiled) throw new Error(`${key} could not be compiled.`);
  return { ...compiled, source: source(entity) };
}

function changedText(
  args: Record<string, unknown>,
  key: string,
  incoming: string | undefined,
  existing: string | null | undefined,
) {
  const clean = optional(incoming);
  if (clean !== undefined && clean !== (existing ?? "")) args[key] = clean;
}

function projectStateArgs(
  entity: ProjectEntity,
  existing: ProjectWithState | undefined,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  changedText(args, "current_state", entity.currentState, existing?.state?.current_state);
  changedText(args, "next_action", entity.nextAction, existing?.state?.next_action);
  changedText(args, "open_loops", entity.openLoops, existing?.state?.open_loops);
  changedText(args, "blockers", entity.blockers, existing?.state?.blockers);
  changedText(args, "waiting_on", entity.waitingOn, existing?.state?.waiting_on);
  changedText(args, "decisions", entity.decisions, existing?.state?.decisions);
  changedText(
    args,
    "recent_changes",
    entity.recentChanges,
    existing?.state?.recent_changes,
  );
  if (
    entity.confidence !== undefined &&
    entity.confidence !== existing?.state?.confidence
  ) {
    args.confidence = entity.confidence;
  }
  return args;
}

function taskProjectReference(
  entity: TaskEntity,
  projectByName: Map<string, ProjectWithState>,
  newProjectNames: Set<string>,
): { project_id?: string; project_name?: string } {
  const projectName = optional(entity.projectName);
  if (!projectName) return {};
  const existing = projectByName.get(normalized(projectName));
  if (existing) return { project_id: existing.id };
  if (newProjectNames.has(normalized(projectName))) {
    return { project_name: projectName };
  }
  throw new Error(
    `Task "${entity.title}" references unknown project "${projectName}".`,
  );
}

export function compileDocumentEntities(
  entities: DocumentEntity[],
  context: DocumentCompileContext,
): { proposals: ProposedAction[]; summary: DocumentImportSummary } {
  const seenSourceIds = new Set<string>();
  for (const entity of entities) {
    if (seenSourceIds.has(entity.sourceId)) {
      throw new Error(`Duplicate source record ${entity.sourceId}.`);
    }
    seenSourceIds.add(entity.sourceId);
  }

  const projectByName = new Map(
    context.projects.map((project) => [normalized(project.name), project]),
  );
  const projectEntities = entities.filter(
    (entity): entity is ProjectEntity => entity.kind === "project",
  );
  const newProjectNames = new Set<string>();
  for (const entity of projectEntities) {
    const name = normalized(entity.name);
    if (newProjectNames.has(name)) {
      throw new Error(`Duplicate project "${entity.name}" in the sources.`);
    }
    if (!projectByName.has(name)) newProjectNames.add(name);
  }

  const projectCreates: ProposedAction[] = [];
  const projectUpdates: ProposedAction[] = [];
  const taskChanges: ProposedAction[] = [];
  const stateChanges: ProposedAction[] = [];
  const otherChanges: ProposedAction[] = [];
  const changedSourceIds = new Set<string>();

  for (const entity of projectEntities) {
    const existing = projectByName.get(normalized(entity.name));
    if (!existing) {
      projectCreates.push(
        proposal(
          "create_project",
          {
            name: entity.name.trim(),
            ...(optional(entity.summary) ? { summary: entity.summary!.trim() } : {}),
            ...(entity.status ? { status: entity.status } : {}),
            ...(optional(entity.owner) ? { owner: entity.owner!.trim() } : {}),
          },
          entity,
        ),
      );
      changedSourceIds.add(entity.sourceId);
    } else {
      const args: Record<string, unknown> = { id: existing.id };
      changedText(args, "summary", entity.summary, existing.summary);
      changedText(args, "owner", entity.owner, existing.owner);
      if (entity.status && entity.status !== existing.status) {
        args.status = entity.status;
      }
      if (Object.keys(args).length > 1) {
        projectUpdates.push(proposal("update_project", args, entity));
        changedSourceIds.add(entity.sourceId);
      }
    }
    const stateArgs = projectStateArgs(entity, existing);
    if (Object.keys(stateArgs).length > 0) {
      stateChanges.push(
        proposal(
          "update_project_state",
          {
            ...(existing
              ? { project_id: existing.id }
              : { project_name: entity.name.trim() }),
            ...stateArgs,
          },
          entity,
        ),
      );
      changedSourceIds.add(entity.sourceId);
    }
  }

  const tasksByIdentity = new Map<string, Task>();
  for (const task of context.tasks) {
    const projectName = task.project_id
      ? context.projects.find((project) => project.id === task.project_id)?.name
      : "";
    tasksByIdentity.set(
      `${normalized(projectName)}\u0000${normalized(task.title)}`,
      task,
    );
  }
  for (const entity of entities) {
    if (entity.kind !== "task") continue;
    const projectRef = taskProjectReference(
      entity,
      projectByName,
      newProjectNames,
    );
    const identity = `${normalized(entity.projectName)}\u0000${normalized(entity.title)}`;
    const existing = tasksByIdentity.get(identity);
    if (!existing) {
      taskChanges.push(
        proposal(
          "create_task",
          {
            title: entity.title.trim(),
            ...(optional(entity.notes) ? { notes: entity.notes!.trim() } : {}),
            ...(entity.status ? { status: entity.status } : {}),
            ...(entity.priority ? { priority: entity.priority } : {}),
            ...(entity.impact ? { impact: entity.impact } : {}),
            ...(entity.effort ? { effort: entity.effort } : {}),
            ...(optional(entity.category)
              ? { category: entity.category!.trim() }
              : {}),
            ...(optional(entity.delegateTo)
              ? { delegate_to: entity.delegateTo!.trim() }
              : {}),
            ...(optional(entity.dueAt) ? { due_at: entity.dueAt!.trim() } : {}),
            ...projectRef,
          },
          entity,
        ),
      );
      changedSourceIds.add(entity.sourceId);
      continue;
    }
    const args: Record<string, unknown> = { id: existing.id };
    changedText(args, "notes", entity.notes, existing.notes);
    changedText(args, "category", entity.category, existing.category);
    changedText(args, "delegate_to", entity.delegateTo, existing.delegate_to);
    changedText(args, "due_at", entity.dueAt, existing.due_at);
    for (const [key, incoming, current] of [
      ["status", entity.status, existing.status],
      ["priority", entity.priority, existing.priority],
      ["impact", entity.impact, existing.impact],
      ["effort", entity.effort, existing.effort],
    ] as const) {
      if (incoming !== undefined && incoming !== current) args[key] = incoming;
    }
    if (
      projectRef.project_id &&
      projectRef.project_id !== existing.project_id
    ) {
      args.project_id = projectRef.project_id;
    }
    if (Object.keys(args).length > 1) {
      taskChanges.push(proposal("update_task", args, entity));
      changedSourceIds.add(entity.sourceId);
    }
  }

  for (const entity of entities) {
    if (entity.kind === "contact") {
      otherChanges.push(
        proposal(
          "save_contact",
          {
            name: entity.name.trim(),
            ...(optional(entity.email) ? { email: entity.email!.trim() } : {}),
            ...(optional(entity.company)
              ? { company: entity.company!.trim() }
              : {}),
            notes: entity.notes.trim(),
          },
          entity,
        ),
      );
    } else if (entity.kind === "memory") {
      otherChanges.push(
        proposal(
          "save_kb_fact",
          {
            title: entity.title.trim(),
            body: entity.body.trim(),
            ...(entity.tags?.length ? { tags: entity.tags } : {}),
          },
          entity,
        ),
      );
    } else if (entity.kind === "instruction") {
      otherChanges.push(
        proposal(
          "save_instruction",
          { title: entity.title.trim(), body: entity.body.trim() },
          entity,
        ),
      );
    } else if (entity.kind === "note") {
      otherChanges.push(
        proposal(
          "create_note",
          {
            title: entity.title.trim(),
            body: entity.body.trim(),
            ...(entity.pinned !== undefined ? { pinned: entity.pinned } : {}),
          },
          entity,
        ),
      );
    } else {
      continue;
    }
    changedSourceIds.add(entity.sourceId);
  }

  const proposals = [
    ...projectCreates,
    ...projectUpdates,
    ...taskChanges,
    ...stateChanges,
    ...otherChanges,
  ];
  const byKind: DocumentImportSummary["byKind"] = {};
  for (const entity of entities) {
    byKind[entity.kind] = (byKind[entity.kind] ?? 0) + 1;
  }
  return {
    proposals,
    summary: {
      sourceCount: new Set(entities.map((entity) => entity.sourceName)).size,
      recordCount: entities.length,
      proposalCount: proposals.length,
      noChangeCount: entities.length - changedSourceIds.size,
      ambiguousCount: 0,
      ignoredCount: 0,
      byKind,
    },
  };
}

export function formatDocumentImportVerification(
  summary: DocumentImportSummary,
): string {
  const kinds = Object.entries(summary.byKind)
    .filter(([, count]) => count)
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
    .join(" · ");
  return `Extracted ${summary.recordCount} source records${kinds ? ` (${kinds})` : ""}: ${summary.proposalCount} changes · ${summary.noChangeCount} already current.`;
}
