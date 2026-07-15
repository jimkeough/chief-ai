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
  /**
   * True when failure is a known Front/Connect gap (e.g. teammate-scoped
   * private tags) rather than broken Pipedream project credentials.
   */
  expectedGap?: boolean;
  note?: string;
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

function isTeammateTagsTarget(target: string): boolean {
  return target.includes("/teammates/") && target.includes("/tags");
}

function isTagConversationsTarget(target: string): boolean {
  return /\/tags\/tag_[^/?]+\/conversations/.test(target);
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
    const message = error instanceof Error ? error.message : "proxy failed";
    const teammateTags = isTeammateTagsTarget(target);
    const tagConversations = isTagConversationsTarget(target);
    return {
      appSlug: connection.appSlug,
      accountId: connection.accountId,
      label: connection.accountName ?? connection.appName,
      target,
      ok: false,
      error: message,
      ...(teammateTags
        ? {
            expectedGap: true,
            note: "Known gap: Front often denies teammate-scoped /tags through Connect Proxy even when /me, company /tags, and /conversations/search work. Not a Pipedream project-credential failure. Set Config → Front — Chief Inbox Zero tag id (tag_…) to skip this lookup.",
          }
        : {}),
      ...(tagConversations
        ? {
            expectedGap: true,
            note: "Private-tag conversation list denied. If the teammate preference for individual API access is already on, the Front OAuth grant behind Pipedream almost certainly lacks Private Resources — use a custom Front OAuth client (or company/shared tag), not the preference toggle.",
          }
        : {}),
    };
  }
}

/** Probe URLs known to be cheap GETs for common Connect apps. */
function probeTargetsForApp(
  appSlug: string,
  opts?: { teammateId?: string; inboxZeroTagId?: string },
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
    const tagId = (opts?.inboxZeroTagId ?? "").trim();
    if (/^tag_[a-zA-Z0-9]+$/.test(tagId)) {
      targets.push(
        `/tags/${encodeURIComponent(tagId)}`,
        `/tags/${encodeURIComponent(tagId)}/conversations?limit=1`,
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
  frontConfig: {
    teammateId: string | null;
    inboxZeroTagId: string | null;
  };
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

  const { getAppSettings } = await import("@/lib/settings");
  const { normalizeFrontTagId, normalizeFrontTeammateId, textField } =
    await import("@/lib/front-search-helpers");
  const settings = await getAppSettings().catch(() => null);
  const teammateIdRaw = normalizeFrontTeammateId(
    settings?.["front.teammate_id"] ?? "",
  );
  const teammateId = /^tea_[a-zA-Z0-9]+$/.test(teammateIdRaw)
    ? teammateIdRaw
    : null;
  let inboxZeroTagId: string | null = null;
  const tagIdRaw = textField(settings?.["front.inbox_zero_tag_id"]);
  if (tagIdRaw) {
    try {
      inboxZeroTagId = normalizeFrontTagId(tagIdRaw);
    } catch {
      inboxZeroTagId = null;
    }
  }

  const proxyProbes: ProxyProbe[] = [];
  const front = await findPipedreamConnectionByApp(
    userId,
    FRONTAPP_PIPEDREAM_SLUG,
  );
  if (front) {
    for (const target of probeTargetsForApp(front.appSlug, {
      teammateId: teammateId ?? undefined,
      inboxZeroTagId: inboxZeroTagId ?? undefined,
    })) {
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
      isTeammateTagsTarget(p.target),
  );
  const teammateTagsProbed = proxyProbes.some(
    (p) =>
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG && isTeammateTagsTarget(p.target),
  );
  const teammateTagsGap =
    teammateTagsProbed &&
    !proxyFrontTeammateTagsOk &&
    (proxyFrontCompanyTagsOk || proxyFrontMeOk || proxyFrontSearchOk);

  const tagConversationsProbed = proxyProbes.some(
    (p) =>
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG && isTagConversationsTarget(p.target),
  );
  const proxyFrontTagConversationsOk = proxyProbes.some(
    (p) =>
      p.ok &&
      p.appSlug === FRONTAPP_PIPEDREAM_SLUG &&
      isTagConversationsTarget(p.target),
  );
  const tagConversationsGap =
    tagConversationsProbed &&
    !proxyFrontTagConversationsOk &&
    (proxyFrontCompanyTagsOk || proxyFrontMeOk || proxyFrontSearchOk);

  let summary: string;
  if (tagConversationsGap) {
    summary = inboxZeroTagId
      ? `GET /tags/${inboxZeroTagId}/conversations is denied (403) while other Front proxy paths work. If the individual-resources preference is already on, the Front OAuth grant behind Pipedream lacks Private Resources — add a custom Front OAuth client with that namespace (or use a company/shared tag), then reconnect. Not broken Pipedream project credentials.`
      : "GET /tags/{id}/conversations is denied while other Front proxy paths work — Private Resources missing on the Front OAuth grant, or set Config front.inbox_zero_tag_id to probe a specific tag.";
  } else if (teammateTagsGap && !inboxZeroTagId) {
    summary =
      "Known gap: /teammates/{id}/tags is denied through Connect Proxy while other Front proxy paths work — this is NOT broken Pipedream project credentials. Set Config → Front — Chief Inbox Zero tag id (tag_…) so Search can run tag:{id} is:open without that lookup. Get tag_… from a tagged conversation's tags[].id (not the numeric settings URL).";
  } else if (teammateTagsGap && inboxZeroTagId) {
    summary = proxyFrontTagConversationsOk
      ? `Teammate /tags is still denied (expected); Config front.inbox_zero_tag_id=${inboxZeroTagId} is set and /tags/{id}/conversations works.`
      : proxyFrontSearchOk
        ? `Teammate /tags is still denied (expected); Config front.inbox_zero_tag_id=${inboxZeroTagId} is set so tagged Search can skip that lookup. Connect Proxy Search looks healthy.`
        : `Teammate /tags is still denied (expected); Config front.inbox_zero_tag_id=${inboxZeroTagId} is set. Fix /conversations/search next if tagged inventory still fails.`;
  } else if (frontMcp.ok && proxyFrontSearchOk) {
    summary =
      "Front MCP works and Connect Proxy can call Front Search API. Tag search should use GET /conversations/search/{query} with an explicit tag_… id when private-tag listing fails.";
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
    frontConfig: {
      teammateId,
      inboxZeroTagId,
    },
    connections: connections.map((c) => ({
      appSlug: c.appSlug,
      accountId: c.accountId,
      label: c.accountName ?? c.appName,
      healthy: c.healthy,
    })),
  };
}
