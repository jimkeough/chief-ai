// Undo descriptors: the executor returns one alongside each successful
// standard-tier write, describing the exact inverse operation. The receipt
// card holds onto it; if the user taps Undo, /api/actions/undo applies it.
//
// Same trust model as every write: the descriptor round-trips through the
// client, so the undo route treats it as user input — kind is default-denied
// against the union below and restore fields are whitelisted per entity. RLS
// scopes every touched row to the signed-in user regardless.
//
// Connector (broker) writes get NO descriptor — they ran on an external
// system we can't safely reverse — so their receipts have no Undo.

export type UndoDescriptor =
  | { kind: "delete_task"; id: string; label: string }
  | { kind: "restore_task"; id: string; fields: Record<string, unknown>; label: string }
  | { kind: "delete_project"; id: string; label: string }
  | { kind: "restore_project"; id: string; fields: Record<string, unknown>; label: string }
  | {
      kind: "restore_project_state";
      project_id: string;
      fields: Record<string, unknown>;
      label: string;
    }
  | { kind: "delete_project_state"; project_id: string; label: string }
  | { kind: "delete_kb"; id: string; label: string }
  | {
      kind: "restore_kb";
      id: string;
      title: string;
      body: string;
      tags: string[];
      label: string;
    }
  | { kind: "delete_contact"; id: string; label: string }
  | { kind: "unarchive_thread"; thread_id: string; label: string };

export const UNDO_KINDS = new Set<string>([
  "delete_task",
  "restore_task",
  "delete_project",
  "restore_project",
  "restore_project_state",
  "delete_project_state",
  "delete_kb",
  "restore_kb",
  "delete_contact",
  "unarchive_thread",
]);
