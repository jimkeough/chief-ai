// Per-tool permission overrides for broker servers — the user-facing dial on
// top of the annotation-based gate. Modes:
//
//   "auto" — run without approval. ONLY honored for tools whose MCP
//            annotations say read-only; a write can never be promoted to
//            auto. This asymmetry IS the trust contract.
//   "ask"  — always show an approval card (demotes a read to gated).
//   "off"  — never expose the tool to the model, and refuse it in the
//            executor even if proposed.
//
// Stored as JSON in the connect.tool_overrides setting, keyed by server name
// then tool name; absent = default (reads auto, writes ask). Managed from the
// Config → Connections tool list.

import { getAppSettings, saveAppSettings } from "@/lib/settings";

export type ToolMode = "auto" | "ask" | "off";

export type ToolOverrides = Record<string, Record<string, ToolMode>>;

const VALID: ToolMode[] = ["auto", "ask", "off"];

export async function getToolOverrides(): Promise<ToolOverrides> {
  const raw = (await getAppSettings())["connect.tool_overrides"].trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ToolOverrides = {};
    for (const [server, tools] of Object.entries(parsed)) {
      if (!tools || typeof tools !== "object") continue;
      const clean: Record<string, ToolMode> = {};
      for (const [tool, mode] of Object.entries(tools as Record<string, unknown>)) {
        if (VALID.includes(mode as ToolMode)) clean[tool] = mode as ToolMode;
      }
      if (Object.keys(clean).length) out[server] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Set (or clear, with null) one tool's mode. The caller is responsible for
 *  refusing "auto" on write tools — enforcement also re-checks annotations
 *  live, so a stale/forged override can never auto-run a write. */
export async function saveToolOverride(
  userId: string,
  server: string,
  tool: string,
  mode: ToolMode | null,
): Promise<ToolOverrides> {
  const overrides = await getToolOverrides();
  const forServer = overrides[server] ?? {};
  if (mode === null) delete forServer[tool];
  else forServer[tool] = mode;
  if (Object.keys(forServer).length === 0) delete overrides[server];
  else overrides[server] = forServer;
  await saveAppSettings(
    { "connect.tool_overrides": JSON.stringify(overrides) },
    userId,
  );
  return overrides;
}

/** The effective treatment of one tool, given its live annotation and any
 *  override: returns "off", "ask" (gated write / approval card), or "auto"
 *  (transparent read). Writes can never come out "auto". */
export function effectiveMode(
  readOnly: boolean,
  override: ToolMode | undefined,
): ToolMode {
  if (override === "off") return "off";
  if (!readOnly) return "ask"; // writes: ask or off, never auto
  return override === "ask" ? "ask" : "auto";
}
