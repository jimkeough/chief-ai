// Front API playground: run a read-only Front Core API GET with either stored
// credential (the API token or the OAuth grant), optionally following the
// _pagination.next cursor, and report the counts + a sample. Single-user, GET
// only, api2.frontapp.com only — a debugging surface, not a general proxy.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getFrontApiToken } from "@/lib/front-api";
import { getFrontAccessToken } from "@/lib/front-auth";
import { asRecord, FRONT_API_BASE, resultsFrom, textField } from "@/lib/front-search-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PAGES = 25;

function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter a Front API path, e.g. /tags/tag_6a990e/conversations");
  let url: URL;
  if (/^https?:\/\//i.test(raw)) {
    url = new URL(raw);
    if (url.hostname.toLowerCase() !== "api2.frontapp.com") {
      throw new Error("Only api2.frontapp.com paths are allowed.");
    }
  } else {
    url = new URL(`${FRONT_API_BASE}${raw.startsWith("/") ? raw : `/${raw}`}`);
  }
  return url.toString();
}

type Sample = { id: string; subject: string; status: string };

function sampleOf(item: unknown): Sample {
  const record = asRecord(item);
  return {
    id: textField(record.id),
    subject: textField(record.subject) || "(no subject)",
    status: textField(record.status) || textField(record.status_category),
  };
}

export async function POST(request: Request) {
  if (!(await getAuthed())) return unauthorized();
  try {
    const body = (await request.json().catch(() => null)) as {
      path?: unknown;
      credential?: unknown;
      follow?: unknown;
    } | null;
    const credential =
      body?.credential === "oauth"
        ? "oauth"
        : body?.credential === "mcp"
          ? "mcp"
          : "api";
    const follow = body?.follow !== false;

    // MCP path: search_conversations acts as the authorizing teammate (you), so
    // it sees every inbox you can — the Core REST tag endpoint is per-inbox
    // access-limited. Extract the tag id from the path and page through it.
    if (credential === "mcp") {
      const tagMatch = /tag_[a-zA-Z0-9]+/.exec(String(body?.path ?? ""));
      if (!tagMatch) {
        throw new Error("For MCP search, include a tag id (tag_…) in the path.");
      }
      const tagId = tagMatch[0];
      const { searchFrontConversationsViaOfficialMcp } = await import(
        "@/lib/front-mcp-read"
      );
      const byId = new Map<string, Sample>();
      const pageCounts: number[] = [];
      let cursor: string | undefined;
      let reported: number | undefined;
      let mcpPages = 0;
      do {
        const r = await searchFrontConversationsViaOfficialMcp({
          tagId,
          status: "all",
          cursor,
        });
        mcpPages += 1;
        pageCounts.push(r.conversations.length);
        for (const c of r.conversations) {
          if (c.id) byId.set(c.id, { id: c.id, subject: c.subject, status: c.status });
        }
        if (typeof r.total === "number") reported = r.total;
        cursor = follow ? r.nextCursor ?? undefined : undefined;
      } while (cursor && mcpPages < MAX_PAGES);
      return Response.json({
        ok: true,
        credential,
        status: 200,
        pages: mcpPages,
        pageCounts,
        totalUnique: byId.size,
        totalReported: reported,
        sample: [...byId.values()].slice(0, 40),
        firstPageRaw: "",
      });
    }

    const token =
      credential === "oauth"
        ? await getFrontAccessToken()
        : await getFrontApiToken();
    if (!token) {
      throw new Error(
        credential === "oauth"
          ? "No Front OAuth connection. Connect Front · Official MCP, or use the API token."
          : "No Front API token saved. Add one under Front · API token first.",
      );
    }

    let nextUrl: string | null = normalizeUrl(String(body?.path ?? ""));
    const byId = new Map<string, Sample>();
    const pageCounts: number[] = [];
    let firstStatus = 0;
    let totalReported: number | undefined;
    let firstRaw = "";
    let pages = 0;

    while (nextUrl && pages < (follow ? MAX_PAGES : 1)) {
      const response: Response = await fetch(nextUrl, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      pages += 1;
      if (pages === 1) firstStatus = response.status;
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 400);
        return Response.json({
          ok: false,
          credential,
          status: response.status,
          error: detail || `HTTP ${response.status}`,
        });
      }
      const json: unknown = await response.json();
      if (pages === 1) firstRaw = JSON.stringify(json).slice(0, 1500);
      const envelope = asRecord(json);
      if (typeof envelope._total === "number") totalReported = envelope._total;
      const page = resultsFrom(json);
      pageCounts.push(page.length);
      for (const item of page) {
        const s = sampleOf(item);
        if (s.id) byId.set(s.id, s);
      }
      const next = textField(asRecord(envelope._pagination).next);
      nextUrl = next && next.startsWith("http") ? next : null;
    }

    return Response.json({
      ok: true,
      credential,
      status: firstStatus,
      pages,
      pageCounts,
      totalUnique: byId.size,
      totalReported,
      sample: [...byId.values()].slice(0, 40),
      firstPageRaw: firstRaw,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Playground request failed." },
      { status: 400 },
    );
  }
}
