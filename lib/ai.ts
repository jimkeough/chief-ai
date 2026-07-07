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
 *  AI_GATEWAY_API_KEY (local dev), then the deployment's OIDC token. Null when
 *  gateway mode has nothing to authenticate with.
 *
 *  The OIDC token is the subtle one: on Vercel it's an env var only at BUILD
 *  time — at RUNTIME it arrives as a request header, so `process.env` is empty
 *  and we must read it via `getVercelOidcToken()` (which pulls it from the
 *  request context). It's issued only when the project has "Secure Backend
 *  Access" enabled. Async because of that lookup. */
export async function resolveGatewayKey(
  settings?: Partial<AppSettings>,
): Promise<string | null> {
  const pasted = settings?.["ai.gateway_key"]?.trim();
  if (pasted) return pasted;
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  // Build-time, or `vercel env pull` locally, expose it as an env var.
  if (process.env.VERCEL_OIDC_TOKEN) return process.env.VERCEL_OIDC_TOKEN;
  // Runtime on Vercel: read it from the request context. Dynamic-import so
  // non-Vercel/local/no-request contexts degrade to null instead of throwing.
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    const token = (await getVercelOidcToken())?.trim();
    if (token) return token;
  } catch {
    /* not on Vercel, Secure Backend Access off, or no request context */
  }
  return null;
}

/** The EFFECTIVE provider: the configured choice ("gateway" by default), with
 *  one graceful fallback — gateway chosen but no gateway credential in sight
 *  while an Anthropic key exists → use the Anthropic key. An explicit
 *  "anthropic" is always respected. */
export async function resolveProvider(
  settings?: Partial<AppSettings>,
): Promise<AiProvider> {
  const raw = (settings?.["ai.provider"] ?? process.env.AI_PROVIDER ?? "gateway")
    .trim()
    .toLowerCase();
  if (raw === "anthropic") return "anthropic";
  if (!(await resolveGatewayKey(settings)) && process.env.ANTHROPIC_API_KEY) {
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

  const provider = await resolveProvider(settings);

  let model =
    opts?.model ??
    process.env.ANTHROPIC_MODEL ??
    settings?.["chief.model"] ??
    DEFAULT_MODEL;
  model = model.trim() || DEFAULT_MODEL;

  if (provider === "gateway") {
    const apiKey = await resolveGatewayKey(settings);
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
