// Central AI client factory. One place decides which provider Chief talks to
// and hands back a ready `@anthropic-ai/sdk` client + resolved model id, so the
// call sites stay identical whether we go straight to Anthropic (the sovereign
// default) or through Vercel AI Gateway (optional, opt-in).
//
// Sovereignty note: the default is unchanged — your Anthropic key, sent only to
// Anthropic. Gateway mode stays sovereign by construction: each deployment is
// the user's OWN Vercel project, so gateway traffic authenticates with that
// project's auto-injected OIDC token and bills to the user's own Vercel
// account — no operator sits in the path, unlike Chief Connect. The only trust
// give is that Vercel (the user's own vendor) meters the prompts it routes.
// The eject path is one setting: flip `ai.provider` back to "anthropic".
// See TRUST.md.

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

  const providerRaw =
    settings?.["ai.provider"] ?? process.env.AI_PROVIDER ?? "anthropic";
  const provider: AiProvider =
    providerRaw.trim().toLowerCase() === "gateway" ? "gateway" : "anthropic";

  let model =
    opts?.model ??
    process.env.ANTHROPIC_MODEL ??
    settings?.["chief.model"] ??
    DEFAULT_MODEL;
  model = model.trim() || DEFAULT_MODEL;

  if (provider === "gateway") {
    // On the user's own Vercel deployment the OIDC token is injected
    // automatically, so no key is needed to paste. A pasted key (or the
    // AI_GATEWAY_API_KEY env, handy for local dev) takes precedence.
    const apiKey =
      settings?.["ai.gateway_key"]?.trim() ||
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN;
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
