// Central AI client factory. One place decides which provider Chief talks to
// and hands back a ready `@anthropic-ai/sdk` client + resolved model id, so the
// call sites stay identical whether we go through Vercel AI Gateway (the
// default) or straight to Anthropic with your own key.
//
// Sovereignty note: gateway mode is the default because it is the only
// provider that works with ZERO keys to fetch — each deployment is the user's
// OWN Vercel project, so gateway traffic authenticates with that project's
// auto-injected OIDC token and bills to the user's own Vercel account. The only
// trust give is that Vercel (the user's own vendor) meters the prompts it
// routes. The eject
// path is one setting: flip `ai.provider` to "anthropic" and set
// ANTHROPIC_API_KEY — prompts then go only to Anthropic. And when gateway mode
// has no credential at all (e.g. local dev without OIDC) but an Anthropic key
// is present, we fall back to it rather than failing. See TRUST.md.

import Anthropic from "@anthropic-ai/sdk";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { FREE_FALLBACK_MODELS } from "@/lib/ai-errors";

// Re-exported so call sites keep a single import surface ("@/lib/ai"). The
// definitions live in the dependency-free lib/ai-errors.ts so they stay
// unit-testable. See that file for the rationale on the fallback CHAIN.
export {
  FREE_FALLBACK_MODELS,
  classifyAiError,
  isRetryableAiError,
  describeAiError,
  type AiErrorKind,
} from "@/lib/ai-errors";

export const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
const DEFAULT_MODEL = "claude-sonnet-5";

export type AiProvider = "anthropic" | "gateway";

export type ResolvedAi = {
  client: Anthropic;
  model: string;
  provider: AiProvider;
  /** Gateway-only `providerOptions` to spread into each messages create/stream
   *  call: a free-model fallback, plus BYOK when the user pasted a provider
   *  key. Undefined in direct-Anthropic mode. */
  providerOptions?: Record<string, unknown>;
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

    // Gateway routing options. A free-model fallback CHAIN so a premium model
    // the account can't reach degrades to a working one instead of erroring
    // (and so one dead fallback id can't take the net down with it); and BYOK
    // so a pasted Anthropic key runs premium models on the user's own Anthropic
    // billing (no Vercel paid credits needed).
    const gateway: Record<string, unknown> = {};
    const fallbacks = FREE_FALLBACK_MODELS.filter((m) => m !== model);
    if (fallbacks.length) gateway.models = fallbacks;
    const byok = settings?.["ai.byok_anthropic_key"]?.trim();
    if (byok) gateway.byok = { anthropic: [{ apiKey: byok }] };

    return {
      client: new Anthropic({ apiKey, baseURL: AI_GATEWAY_BASE_URL }),
      model,
      provider,
      ...(Object.keys(gateway).length ? { providerOptions: { gateway } } : {}),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { client: new Anthropic({ apiKey }), model, provider };
}

/** Resolve the environment variables the Claude Code CLI needs to authenticate,
 *  honoring the same provider choice as the rest of Chief. In gateway mode
 *  (the sovereign default) Claude Code is pointed at the Vercel AI Gateway with
 *  the deployment's OIDC token as a bearer — no raw Anthropic key needed; in
 *  anthropic mode it gets the key directly. Returns `{ error }` when the chosen
 *  provider has no usable credential. Used by the sandbox coding agent so
 *  "gateway only" setups can run it. */
export async function resolveSandboxAgentEnv(
  settings?: AppSettings,
): Promise<Record<string, string> | { error: string }> {
  let s = settings;
  if (!s) {
    try {
      s = await getAppSettings();
    } catch {
      s = undefined;
    }
  }
  const provider = await resolveProvider(s);
  let model = (s?.["chief.model"] ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  if (provider === "gateway") {
    const token = await resolveGatewayKey(s);
    if (!token) {
      return {
        error:
          "gateway mode has no credential — enable Vercel Settings → Security → Secure Backend Access so the OIDC token is issued, or set an AI Gateway key in Config.",
      };
    }
    // Gateway model ids are provider-prefixed; a bare id is assumed Anthropic.
    if (!model.includes("/")) model = `anthropic/${model}`;
    // Point Claude Code at the gateway's Anthropic-compatible endpoint with the
    // OIDC token as a bearer (ANTHROPIC_AUTH_TOKEN → `Authorization: Bearer`).
    // Pin the small/fast model to the same gateway id so Claude Code's
    // background calls don't hit an unprefixed default the gateway won't accept.
    return {
      ANTHROPIC_BASE_URL: AI_GATEWAY_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
    };
  }

  const key = process.env.ANTHROPIC_API_KEY || s?.["ai.byok_anthropic_key"]?.trim();
  if (!key) {
    return { error: "anthropic mode is selected but no ANTHROPIC_API_KEY is set." };
  }
  const env: Record<string, string> = { ANTHROPIC_API_KEY: key };
  // Direct Anthropic uses bare ids; only forward a non-prefixed one.
  if (model && !model.includes("/")) env.ANTHROPIC_MODEL = model;
  return env;
}

// ---------------------------------------------------------------------------
// Model preflight (diagnostics)
//
// Verify that the model ids Chief is about to use actually exist in the
// gateway catalog — the check that would have caught the `kimi-k2.7` bug at
// setup instead of mid-conversation. Existence is NOT entitlement: a listed
// premium model may still be unusable without credits, which surfaces at call
// time via describeAiError. This only catches bogus/deprecated ids.
// ---------------------------------------------------------------------------

/** Fetch the set of model ids the gateway currently serves. Best-effort:
 *  returns null when there's no gateway credential or the catalog can't be
 *  read (offline, non-Vercel, etc.). The gateway is OpenAI-compatible, so
 *  `/v1/models` returns `{ data: [{ id }, …] }`. */
export async function fetchGatewayModelIds(
  settings?: Partial<AppSettings>,
): Promise<Set<string> | null> {
  const apiKey = await resolveGatewayKey(settings);
  if (!apiKey) return null;
  try {
    const res = await fetch(`${AI_GATEWAY_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length ? new Set(ids) : null;
  } catch {
    return null;
  }
}

export type ModelHealthEntry = {
  id: string;
  role: "primary" | "fallback";
  /** Present in the gateway catalog. Only meaningful when `checked` is true. */
  ok: boolean;
};

export type ModelHealth = {
  /** Whether we could actually read the catalog to verify. False in
   *  direct-Anthropic mode, with no credential, or on a network hiccup. */
  checked: boolean;
  models: ModelHealthEntry[];
};

/** Check the resolved primary model and its gateway fallbacks against the live
 *  catalog. Never throws — degrades to `checked: false`. */
export async function checkModelHealth(
  ai: ResolvedAi,
  settings?: Partial<AppSettings>,
): Promise<ModelHealth> {
  const gw = (ai.providerOptions?.gateway ?? {}) as { models?: string[] };
  const entries: ModelHealthEntry[] = [
    { id: ai.model, role: "primary", ok: false },
    ...(gw.models ?? []).map(
      (id): ModelHealthEntry => ({ id, role: "fallback", ok: false }),
    ),
  ];

  // Only the gateway has a catalog to check against; direct Anthropic mode is
  // pinned to Anthropic's own ids, so treat it as unverifiable-but-fine.
  if (ai.provider !== "gateway") return { checked: false, models: entries };

  const catalog = await fetchGatewayModelIds(settings);
  if (!catalog) return { checked: false, models: entries };
  return {
    checked: true,
    models: entries.map((e) => ({ ...e, ok: catalog.has(e.id) })),
  };
}
