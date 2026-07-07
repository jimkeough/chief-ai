// GET /api/models — the catalog behind the Chief-model picker. Returns the
// models the *currently configured provider* can serve, so the Config field can
// be a searchable dropdown instead of a memorize-the-id text box.
//
// Sovereign by construction, same as lib/ai.ts: in "anthropic" mode we ask
// Anthropic's own /v1/models with your key; in "gateway" mode we ask Vercel AI
// Gateway's OpenAI-compatible /v1/models with the resolved gateway credential
// (pasted key, AI_GATEWAY_API_KEY, or the deployment's OIDC token). No third
// party is introduced that lib/ai.ts wasn't already talking to.
//
// Fails soft: any auth/network hiccup returns an empty list rather than an
// error, so the picker degrades to a plain free-text field and never blocks
// saving a model id by hand.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import {
  AI_GATEWAY_BASE_URL,
  resolveGatewayKey,
  resolveProvider,
} from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Model = { id: string; name: string };

export async function GET() {
  if (!(await getAuthed())) return unauthorized();

  let settings;
  try {
    settings = await getAppSettings();
  } catch {
    settings = undefined;
  }

  // Same resolution as lib/ai.ts — including the fallback to a present
  // Anthropic key when gateway mode has no credential — so the picker always
  // lists the catalog Chief will actually talk to.
  const provider = resolveProvider(settings);

  const models =
    provider === "gateway"
      ? await gatewayModels(resolveGatewayKey(settings) ?? undefined)
      : await anthropicModels();

  return Response.json({ provider, models });
}

/** Vercel AI Gateway catalog (any provider; ids are provider-prefixed). */
async function gatewayModels(apiKey?: string): Promise<Model[]> {
  if (!apiKey) return [];
  try {
    const res = await fetch(`${AI_GATEWAY_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { id?: string; name?: string }[];
    };
    return normalize(
      (body.data ?? []).map((m) => ({ id: m.id ?? "", name: m.name ?? "" })),
    );
  } catch {
    return [];
  }
}

/** Anthropic's own model list (bare Claude ids). */
async function anthropicModels(): Promise<Model[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { id?: string; display_name?: string }[];
    };
    return normalize(
      (body.data ?? []).map((m) => ({
        id: m.id ?? "",
        name: m.display_name ?? "",
      })),
    );
  } catch {
    return [];
  }
}

/** Drop blanks, dedupe by id, and sort id-ascending for a stable dropdown. */
function normalize(models: Model[]): Model[] {
  const seen = new Set<string>();
  const out: Model[] = [];
  for (const m of models) {
    const id = m.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: (m.name || id).trim() });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
