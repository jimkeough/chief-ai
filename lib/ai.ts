// Central AI client factory. One place decides which provider Chief talks to
// and hands back a ready `@anthropic-ai/sdk` client + resolved model id, so the
// call sites stay identical whether we go through Vercel AI Gateway (the
// default) or straight to Anthropic with your own key.
//
// Sovereignty note: gateway mode is the default because it is the only
// provider that works with ZERO keys to fetch — each deployment is the user's
// OWN Vercel project, so gateway traffic authenticates with that project's
// auto-injected OIDC token and bills to the user's own Vercel account. No
// operator sits in the path (unlike Chief Connect); the only trust give is
// that Vercel (the user's own vendor) meters the prompts it routes. The eject
// path is one setting: flip `ai.provider` to "anthropic" and set
// ANTHROPIC_API_KEY — prompts then go only to Anthropic. And when gateway mode
// has no credential at all (e.g. local dev without OIDC) but an Anthropic key
// is present, we fall back to it rather than failing. See TRUST.md.

import Anthropic from "@anthropic-ai/sdk";
import { getAppSettings, type AppSettings } from "@/lib/settings";

export const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
const DEFAULT_MODEL = "claude-opus-4-8";

export type AiProvider = "anthropic" | "gateway";

export type ResolvedAi = {
  client: Anthropic;
  model: string;
  provider: AiProvider;
};

/** The gateway credential, in precedence order: key pasted in Config,
 *  AI_GATEWAY_API_KEY (local dev), the deployment's auto-injected OIDC token.
 *  Null when gateway mode has nothing to authenticate with. */
export function resolveGatewayKey(
  settings?: Partial<AppSettings>,
): string | null {
  return (
    settings?.["ai.gateway_key"]?.trim() ||
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN ||
    null
  );
}

/** The EFFECTIVE provider: the configured choice ("gateway" by default), with
 *  one graceful fallback — gateway chosen but no gateway credential in sight
 *  while an Anthropic key exists → use the Anthropic key. An explicit
 *  "anthropic" is always respected. */
export function resolveProvider(settings?: Partial<AppSettings>): AiProvider {
  const raw = (settings?.["ai.provider"] ?? process.env.AI_PROVIDER ?? "gateway")
    .trim()
    .toLowerCase();
  if (raw === "anthropic") return "anthropic";
  if (!resolveGatewayKey(settings) && process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  return "gateway";
}

/** Resolve the configured AI provider into a ready client + model.
 *
 *  Pass `settings` when the caller already loaded them (saves a round-trip);
 *  otherwise they are read here, tolerating contexts without a user session.
 *  Returns null when the chosen provider has no usable credential — callers
 *  decide whether that is a hard error (Chief) or a graceful skip (home line).
 */
export async function resolveAi(opts?: {
  settings?: AppSettings;
  model?: string;
}): Promise<ResolvedAi | null> {
  let settings = opts?.settings;
  if (!settings) {
    try {
      settings = await getAppSettings();
    } catch {
      settings = undefined;
    }
  }

  const provider = resolveProvider(settings);

  let model =
    opts?.model ??
    process.env.ANTHROPIC_MODEL ??
    settings?.["chief.model"] ??
    DEFAULT_MODEL;
  model = model.trim() || DEFAULT_MODEL;

  if (provider === "gateway") {
    const apiKey = resolveGatewayKey(settings);
    if (!apiKey) return null;
    // Gateway model ids are provider-prefixed (e.g. "anthropic/…", "openai/…").
    // A bare id is assumed to be an Anthropic model.
    if (!model.includes("/")) model = `anthropic/${model}`;
    return {
      client: new Anthropic({ apiKey, baseURL: AI_GATEWAY_BASE_URL }),
      model,
      provider,
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { client: new Anthropic({ apiKey }), model, provider };
}
