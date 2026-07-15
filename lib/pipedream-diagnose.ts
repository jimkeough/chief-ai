// Probe Pipedream Connect Proxy vs MCP for connected apps.
// Calendar working via MCP does not prove Connect Proxy works — different path.

import {
  findPipedreamConnectionByApp,
  pipedreamProxyRequest,
  syncPipedreamConnections,
  type PipedreamConnection,
} from "@/lib/pipedream";
import { listOpenFrontConversations } from "@/lib/front-inbox";
import { FRONTAPP_PIPEDREAM_SLUG } from "@/lib/front-search-helpers";
import { createClient } from "@/lib/supabase/server";

export type ProxyProbe = {
  appSlug: string;
  accountId: string;
  label: string;
  target: string;
  ok: boolean;
  error?: string;
};

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Sign in to diagnose Pipedream.");
  return user.id;
}

async function probeProxy(
  userId: string,
  connection: PipedreamConnection,
  target: string,
): Promise<ProxyProbe> {
  try {
    await pipedreamProxyRequest(userId, {
      accountId: connection.accountId,
      method: "GET",
      url: target,
    });
    return {
      appSlug: connection.appSlug,
      accountId: connection.accountId,
      label: connection.accountName ?? connection.appName,
      target,
      ok: true,
    };
  } catch (error) {
    return {
      appSlug: connection.appSlug,
      accountId: connection.accountId,
      label: connection.accountName ?? connection.appName,
      target,
      ok: false,
      error: error instanceof Error ? error.message : "proxy failed",
    };
  }
}

/** Probe URLs known to be cheap GETs for common Connect apps. */
function probeTargetsForApp(
  appSlug: string,
  opts?: { teammateId?: string },
): string[] {
  const slug = appSlug.toLowerCase();
  if (slug === "frontapp" || slug === "front") {
    // Include Search API — /me can succeed while /conversations/search fails.
    // Teammate /tags is often rejected for private tags even when company /tags works.
    const openSearch = `/conversations/search/${encodeURIComponent("is:open")}?limit=1`;
    const targets = [
      "/me",
      "/tags?limit=1",
      openSearch,
      "https://api2.frontapp.com/me",
      `https://api2.frontapp.com${openSearch}`,
    ];
    const tea = (opts?.teammateId ?? "").trim();
    if (/^tea_[a-zA-Z0-9]+$/.test(tea)) {
      targets.splice(
        2,
        0,
        `/teammates/${encodeURIComponent(tea)}/tags?limit=1`,
      );
    }
    return targets;
  }
  if (slug.includes("google_calendar") || slug === "google_calendar") {
    return [
      "/calendar/v3/users/me/calendarList?maxResults=1",
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
    ];
  }
  if (slug.includes("gmail")) {
    return [
      "/gmail/v1/users/me/profile",
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    ];
  }
  if (slug.includes("slack")) {
    return ["/api/auth.test", "https://slack.com/api/auth.test"];
  }
  return [];
}

export async function diagnosePipedreamConnect(): Promise<{
  summary: string;
  frontMcp: { ok: boolean; detail: string };
  proxyProbes: ProxyProbe[];
  connections: Array<{
    appSlug: string;
    accountId: string;
    label: string;
    healthy: boolean;
  }>;
}> {
  const userId = await requireUserId();
  const connections = await syncPipedreamConnections(userId).catch(() => []);

  let frontMcp: { ok: boolean; detail: string };
  try {
    const listed = await listOpenFrontConversations();
    if (!listed.connected) {
      frontMcp = { ok: false, detail: "Front MCP server not found." };
    } else if ("error" in listed) {
      frontMcp = { ok: false, detail: listed.error };
    } else {
      frontMcp = {
        ok: true,
        detail: `MCP list-conversations returned ${listed.conversations.length} open conversation(s).`,
      };
    }
  } catch (error) {
    frontMcp = {
      ok: false,
      detail: error instanceof Error ? error.message : "Front MCP failed.",
    };
  }

  const proxyProbes: ProxyProbe[] = [];
  const front = await findPipedreamConnectionByApp(
    userId,
    FRONTAPP_PIPEDREAM_SLUG,
  );
  if (front) {
    const { getAppSettings } = await import("@/lib/settings");
    const { normalizeFrontTeammateId } = await import(
      "@/lib/front-search-helpers"
    );
    const settings = await getAppSettings().catch(() => null);
    const teammateId = normalizeFrontTeammateId(
      settings?.["front.teammate_id"] ?? "",
    );
    for (const target of probeTargetsForApp(front.appSlug, { teammateId })) {
      proxyProbes.push(await probeProxy(userId, front, target));
    }
  }

  // Probe up to two other healthy connections to isolate Front vs all-proxy.
  const others = connections
    .filter((c) => c.healthy && c.appSlug !== FRONTAPP_PIPEDREAM_SLUG)
    .slice(0, 2);
  for (const conn of others) {
    const targets = probeTargetsForApp(conn.appSlug);
    if (targets.length === 0) continue;
    proxyProbes.push(await probeProxy(userId, conn, targets[0]!));
  }

  const proxyOk = proxyProbes.some((p) => p.ok);
  const proxyFrontOk = proxyProbes.some(
    (p) => p.ok && p.appSlug === FRONTAPP_PIPEDREAM_SLUG,
  );
  const proxyFrontSearchOk = proxyProbes.some(
    (p) =>
      p.ok &&
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG &&
      p.target.includes("/conversations/search/"),
  );
  const proxyFrontMeOk = proxyProbes.some(
    (p) =>
      p.ok &&
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG &&
      (p.target === "/me" || p.target.endsWith("/me")),
  );
  const proxyFrontCompanyTagsOk = proxyProbes.some(
    (p) =>
      p.ok &&
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG &&
      (p.target === "/tags?limit=1" || p.target.startsWith("/tags?")),
  );
  const proxyFrontTeammateTagsOk = proxyProbes.some(
    (p) =>
      p.ok &&
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG &&
      p.target.includes("/teammates/") &&
      p.target.includes("/tags"),
  );
  const teammateTagsProbed = proxyProbes.some(
    (p) =>
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG &&
      p.target.includes("/teammates/") &&
      p.target.includes("/tags"),
  );

  let summary: string;
  if (frontMcp.ok && proxyFrontSearchOk) {
    summary =
      "Front MCP works and Connect Proxy can call Front Search API. Tag search should use GET /conversations/search/{query} with an explicit tag_… id when private-tag listing fails.";
  } else if (
    frontMcp.ok &&
    proxyFrontCompanyTagsOk &&
    teammateTagsProbed &&
    !proxyFrontTeammateTagsOk
  ) {
    summary =
      "Company /tags works via Proxy but teammate /tags does not — private tags need Config front.inbox_zero_tag_id (tag_…) so Search can skip name lookup.";
  } else if (frontMcp.ok && proxyFrontMeOk && !proxyFrontSearchOk) {
    summary =
      "Front /me works via Proxy but /conversations/search does not — tag search will fail on the Search API path even though diagnose /me looks healthy. Prefer fixing Search proxy targets or rely on MCP list+tag filter.";
  } else if (frontMcp.ok && !proxyFrontOk) {
    summary = proxyOk
      ? "Front MCP works and Connect Proxy works for another app — Front proxy targets are the problem (use MCP list+tag filter fallback)."
      : "Front MCP works; Connect Proxy fails (tested Front and other apps). Calendar/MCP tools can still work while proxy is broken. Tag search should use MCP fallback.";
  } else if (!frontMcp.ok && proxyFrontOk) {
    summary =
      "Connect Proxy to Front works, but Front MCP list failed — check MCP tool modes.";
  } else {
    summary =
      "Neither Front MCP nor Connect Proxy succeeded. Reconnect Front under Settings → Connections.";
  }

  return {
    summary,
    frontMcp,
    proxyProbes,
    connections: connections.map((c) => ({
      appSlug: c.appSlug,
      accountId: c.accountId,
      label: c.accountName ?? c.appName,
      healthy: c.healthy,
    })),
  };
}
