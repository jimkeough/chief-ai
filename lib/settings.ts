// Per-user settings: tunable knobs stored one row per (user, key) in
// `settings`. Anything not set in the DB falls back to the compiled-in default
// below, so the app works the same whether or not a row exists. Ported from
// Email-wrapper's app_settings with the tenancy flipped: settings are the
// user's own rows behind RLS, not global admin state.
//
// To add a setting: add a SettingDef here and read it where it's used. The
// (future) Config page renders SETTING_DEFS automatically.

import { createClient } from "@/lib/supabase/server";

export type SettingKey =
  | "waiting.aging_days"
  | "focus.top_count"
  | "chief.model"
  | "mcp.chat_enabled"
  | "actions.enabled"
  | "web.fetch_enabled"
  | "connectors.max_chief_tools"
  | "mcp.servers"
  | "connect.service_url"
  | "connect.api_key"
  | "connect.apps";

export type SettingDef = {
  key: SettingKey;
  label: string;
  description: string;
  default: string;
  /** Render as a single-line input instead of a textarea. */
  singleLine?: boolean;
  /** Textarea rows hint (longer prompts want more). */
  rows?: number;
  placeholder?: string;
};

// Phase 2 carries only the structural knobs; the Chief prompts arrive with the
// Chief loop (Phase 3) and the config blobs (instructions / voice / about) live
// in the KB, not here.
export const SETTING_DEFS: SettingDef[] = [
  {
    key: "waiting.aging_days",
    label: "Waiting-on — aging threshold (days)",
    description:
      "How many days someone can stay quiet before their dot on the Waiting-on strip turns copper. Green = they moved, gray = quiet, copper = aging.",
    default: "6",
    singleLine: true,
    placeholder: "6",
  },
  {
    key: "focus.top_count",
    label: "Home — ranked tasks shown",
    description:
      "How many top-ranked tasks the Home focus view surfaces above the fold.",
    default: "3",
    singleLine: true,
    placeholder: "3",
  },
  {
    key: "chief.model",
    label: "Chief — model",
    description:
      "The Claude model Chief runs on. Leave at the default unless you have a reason to change it.",
    default: "claude-opus-4-8",
    singleLine: true,
    placeholder: "claude-opus-4-8",
  },
  // --- Chief loop switches (Phase 3) --------------------------------------
  // Two kill switches, both must be on for a write to execute: the master
  // switch gates the whole Chief chat; the actions switch gates proposals +
  // the executor. Sovereign single-user app, so both default ON — the user
  // can flip them off from Config if they ever want a read-only Chief.
  {
    key: "mcp.chat_enabled",
    label: "Chief — master switch",
    description:
      "Master kill switch for the Chief chat (and everything downstream of it). \"on\" or \"off\".",
    default: "on",
    singleLine: true,
    placeholder: "on",
  },
  {
    key: "actions.enabled",
    label: "Chief — write actions",
    description:
      "Kill switch for write proposals and the action executor. When off, Chief is advice-only: it can read but never propose or execute a change. \"on\" or \"off\".",
    default: "on",
    singleLine: true,
    placeholder: "on",
  },
  {
    key: "web.fetch_enabled",
    label: "Chief — web fetch",
    description:
      "Let Chief fetch URLs that appear in the conversation (Anthropic's server-side web_fetch tool, read-only). \"on\" or \"off\".",
    default: "off",
    singleLine: true,
    placeholder: "off",
  },
  {
    key: "connectors.max_chief_tools",
    label: "Connectors — max tools per turn",
    description:
      "Cap on how many connector (MCP) tools are attached to a Chief turn, allocated round-robin across servers (reads first) so one tool-heavy server can't starve the rest.",
    default: "150",
    singleLine: true,
    placeholder: "150",
  },
  {
    key: "mcp.servers",
    label: "Connectors — MCP servers",
    description:
      'JSON array of remote MCP servers Chief can use, e.g. [{"name": "github", "url": "https://…", "authorization_token": "…"}]. Every server is brokered: read-only tools run transparently; anything that writes becomes an approve/reject proposal.',
    default: "",
    rows: 6,
    placeholder: '[{"name": "…", "url": "https://…"}]',
  },
  // --- Chief Connect (optional paid connector hub) --------------------------
  // The 2-click alternative to configuring servers by hand: a small operator-
  // run service (see connect-service/) brokers Pipedream Connect's managed
  // OAuth. Leave blank to stay fully sovereign — every connector has a DIY
  // twin (app password, own OAuth client, direct MCP URL above).
  {
    key: "connect.service_url",
    label: "Chief Connect — service URL",
    description:
      "The Chief Connect service you subscribe to (e.g. https://connect.example.com). Blank = off.",
    default: "",
    singleLine: true,
    placeholder: "https://…",
  },
  {
    key: "connect.api_key",
    label: "Chief Connect — API key",
    description: "The key issued with your Chief Connect subscription.",
    default: "",
    singleLine: true,
    placeholder: "ck_…",
  },
  {
    key: "connect.apps",
    label: "Chief Connect — apps",
    description:
      "Comma-separated Pipedream app slugs to offer (e.g. gmail, google_calendar, notion, slack).",
    default: "gmail, google_calendar",
    singleLine: true,
    placeholder: "gmail, google_calendar",
  },
];

export type AppSettings = Record<SettingKey, string>;

const DEFAULTS = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d.default]),
) as AppSettings;

const VALID_KEYS = new Set<string>(SETTING_DEFS.map((d) => d.key));

/** All settings, with the user's DB overrides layered over the defaults. */
export async function getAppSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) {
    // Best-effort: never break the app because a settings read failed.
    console.error("Failed to load settings:", error.message);
    return { ...DEFAULTS };
  }
  const merged: AppSettings = { ...DEFAULTS };
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    if (VALID_KEYS.has(row.key)) merged[row.key as SettingKey] = row.value;
  }
  return merged;
}

/** A single setting value (override or default). */
export async function getSetting(key: SettingKey): Promise<string> {
  return (await getAppSettings())[key];
}

/** A numeric setting, falling back to its default when unparseable. */
export async function getNumericSetting(key: SettingKey): Promise<number> {
  const raw = await getSetting(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number(DEFAULTS[key]);
}

/** Upsert one or more settings for the signed-in user. Unknown keys ignored. */
export async function saveAppSettings(
  updates: Partial<Record<SettingKey, string>>,
  userId: string,
): Promise<void> {
  const supabase = await createClient();
  const rows = Object.entries(updates)
    .filter(([key]) => VALID_KEYS.has(key))
    .map(([key, value]) => ({ user_id: userId, key, value: value ?? "" }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("settings")
    .upsert(rows, { onConflict: "user_id,key" });
  if (error) throw new Error(error.message);
}
