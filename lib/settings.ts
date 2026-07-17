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
  | "ai.provider"
  | "ai.gateway_key"
  | "ai.byok_anthropic_key"
  | "mcp.chat_enabled"
  | "actions.enabled"
  | "web.fetch_enabled"
  | "connectors.max_chief_tools"
  | "mcp.servers"
  | "mcp.tool_overrides"
  | "front.teammate_id"
  | "pipedream.front_oauth_app_id"
  | "updates.enabled";

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
      "The model Chief runs on. Default is claude-sonnet-5 — strong tool-use at a lower cost than Opus. Search the list to pick another, or type any id by hand. In the default (AI Gateway) mode it can be any gateway model id — e.g. anthropic/claude-opus-4.8 or openai/gpt-5 — a bare id is assumed to be Anthropic. In direct Anthropic mode it's a Claude id like claude-sonnet-5.",
    default: "claude-sonnet-5",
    singleLine: true,
    placeholder: "claude-sonnet-5",
  },
  // --- AI provider (Vercel AI Gateway by default) --------------------------
  // Gateway is the default because it needs ZERO keys on a Vercel deployment:
  // the project's OIDC token authenticates and usage bills to the user's own
  // Vercel account — no console.anthropic.com trip in the funnel. Still
  // sovereign: it's the user's own Vercel project, no operator in the path.
  // Eject by flipping to "anthropic" with an ANTHROPIC_API_KEY set — prompts
  // then go only to Anthropic. When gateway mode has no credential at all,
  // lib/ai.ts falls back to a present Anthropic key. See TRUST.md.
  {
    key: "ai.provider",
    label: "AI — provider",
    description:
      "Where Chief's model calls go. \"gateway\" (default) = Vercel AI Gateway: any model, and on a Vercel deployment the OIDC token authenticates and usage bills to your Vercel account — no Anthropic key needed. \"anthropic\" = your own Anthropic API key, sent only to Anthropic.",
    default: "gateway",
    singleLine: true,
    placeholder: "gateway",
  },
  {
    key: "ai.gateway_key",
    label: "AI Gateway — API key (optional)",
    description:
      "Only for gateway mode. Leave BLANK on a Vercel deployment — the project's OIDC token is used automatically. Paste an AI Gateway key only for local dev or if you prefer an explicit key over OIDC.",
    default: "",
    singleLine: true,
    placeholder: "(blank — uses Vercel OIDC)",
  },
  {
    key: "ai.byok_anthropic_key",
    label: "AI Gateway — bring your own Anthropic key (optional)",
    description:
      "Gateway mode only. Paste your own Anthropic API key to run premium models (Opus) on YOUR Anthropic billing, routed through the gateway — no Vercel paid-credit top-up needed. Blank = use Vercel credits (free-tier models are free; premium needs credits). Your key is stored only in your own database and sent to the gateway per request.",
    default: "",
    singleLine: true,
    placeholder: "sk-ant-… (optional)",
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
    label: "MCP — legacy server import",
    description:
      "Legacy storage imported automatically into the secure MCP connection registry.",
    default: "",
    rows: 6,
    placeholder: "",
  },
  {
    key: "mcp.tool_overrides",
    label: "MCP — per-tool modes (managed)",
    description:
      "JSON managed by the tool list under Connections (auto/ask/off per tool). Reads can be auto; writes are always ask or off. Edit by hand only if you know what you're doing.",
    default: "",
    rows: 3,
    placeholder: '{"front": {"search_conversations": "ask"}}',
  },
  {
    key: "front.teammate_id",
    label: "Front — teammate id (legacy Pipedream)",
    description:
      "Used only by the legacy Pipedream Front proxy. The official Front MCP connection authorizes as your Front user and does not need this.",
    default: "",
    singleLine: true,
    placeholder: "tea_lm2n2",
  },
  {
    key: "pipedream.front_oauth_app_id",
    label: "Pipedream — Front OAuth app id (legacy)",
    description:
      "Used only if you intentionally keep the legacy Pipedream Front connection. Official Front MCP does not use this value.",
    default: "",
    singleLine: true,
    placeholder: "oa_…",
  },
  // Set once the user completes the one-tap "Enable auto-updates" step
  // (see lib/updater-workflow.ts). Gates the "Get this update" button so it
  // never sends a user who hasn't enabled updates yet to GitHub's "create a
  // new workflow" page. Not a user-facing knob — filtered out of the
  // auto-rendered Chief settings list in ConfigClient.
  {
    key: "updates.enabled",
    label: "Updates — auto-updates enabled",
    description: "Internal flag; managed by the Software updates card.",
    default: "off",
    singleLine: true,
    placeholder: "off",
  },
];

export type AppSettings = Record<SettingKey, string>;

const DEFAULTS = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d.default]),
) as AppSettings;

const VALID_KEYS = new Set<string>(SETTING_DEFS.map((d) => d.key));

export function appSettingsFromRows(
  rows: Array<{ key: string; value: string }>,
): AppSettings {
  const merged: AppSettings = { ...DEFAULTS };
  for (const row of rows) {
    if (VALID_KEYS.has(row.key)) merged[row.key as SettingKey] = row.value;
  }
  return merged;
}

/** All settings, with the user's DB overrides layered over the defaults. */
export async function getAppSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) {
    // Best-effort: never break the app because a settings read failed.
    console.error("Failed to load settings:", error.message);
    return { ...DEFAULTS };
  }
  return appSettingsFromRows((data ?? []) as { key: string; value: string }[]);
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
