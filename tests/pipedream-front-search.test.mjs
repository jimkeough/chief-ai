import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPipedreamMcpServerConfig,
  PIPEDREAM_MCP_REGISTRY,
} from "../lib/pipedream-mcp-config.ts";
import {
  buildOpenSearchQuery,
  buildTagConversationsPath,
  buildTagOpenConversationsPath,
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  normalizeFrontTagId,
  normalizeFrontTeammateId,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
} from "../lib/front-search-helpers.ts";

test("requests both public and private Pipedream MCP tools", () => {
  const server = buildPipedreamMcpServerConfig({
    mcpUrl: "https://remote.mcp.pipedream.net/v3",
    projectId: "proj_test",
    environment: "production",
    userId: "user-123",
    token: "secret",
    connection: {
      id: "56a3abcd-1234",
      accountId: "apn_front",
      appSlug: "frontapp",
      appName: "Front",
      accountName: "HomeJab",
    },
  });
  assert.equal(PIPEDREAM_MCP_REGISTRY, "all");
  assert.deepEqual(server.headers, {
    "x-pd-project-id": "proj_test",
    "x-pd-environment": "production",
    "x-pd-external-user-id": "user-123",
    "x-pd-app-slug": "frontapp",
    "x-pd-account-id": "apn_front",
    "x-pd-registry": "all",
  });
  assert.equal(server.toolPrefix, "pd_frontapp_56a3_");
  assert.equal(server.trustAnnotations, true);
});

test("uses Front Core API host and Pipedream SDK-compatible proxy encoding", () => {
  assert.equal(FRONT_API_BASE, "https://api2.frontapp.com");
  const url = `${FRONT_API_BASE}/tags?limit=100`;
  // Matches encodePipedreamProxyTarget in lib/pipedream.ts (@pipedream/sdk style).
  const encoded = Buffer.from(url, "utf8").toString("base64");
  assert.match(encoded, /=/); // standard Base64 keeps padding
  assert.equal(
    encodeURIComponent(encoded),
    "aHR0cHM6Ly9hcGkyLmZyb250YXBwLmNvbS90YWdzP2xpbWl0PTEwMA%3D%3D",
  );
});

test("builds an exact tagged-open Front query", () => {
  assert.equal(
    buildTaggedOpenQuery("tag_Chief123"),
    "is:open tag:tag_Chief123",
  );
  assert.throws(() => buildTaggedOpenQuery("380024798"), /invalid tag ID/);
  assert.equal(DEFAULT_FRONT_INBOX_ZERO_TAG, "Chief Inbox Zero");
});

test("builds open Front search queries without requiring a tag", () => {
  assert.equal(buildOpenSearchQuery({}), "is:open");
  assert.equal(
    buildOpenSearchQuery({ tagId: "tag_Chief123" }),
    "is:open tag:tag_Chief123",
  );
  assert.equal(
    buildOpenSearchQuery({
      assigneeId: "tea_36301790",
    }),
    "is:open assignee:tea_36301790",
  );
  assert.throws(
    () => buildOpenSearchQuery({ assigneeId: "380024798" }),
    /invalid teammate ID/,
  );
});

test("can omit is:open for tag-only / all-status search", () => {
  assert.equal(
    buildOpenSearchQuery({ tagId: "tag_6a990e", status: "all" }),
    "tag:tag_6a990e",
  );
  assert.equal(
    buildOpenSearchQuery({ tagId: "tag_6a990e", status: "archived" }),
    "is:archived tag:tag_6a990e",
  );
  assert.throws(
    () => buildOpenSearchQuery({ status: "all" }),
    /at least one filter/,
  );
});

test("normalizes Front teammate ids from UI tea: form", () => {
  assert.equal(normalizeFrontTeammateId("tea:36301790"), "tea_36301790");
  assert.equal(normalizeFrontTeammateId("tea_36301790"), "tea_36301790");
});

test("rejects numeric Front settings URL ids as tag ids", () => {
  assert.equal(normalizeFrontTagId("tag_abc123"), "tag_abc123");
  assert.throws(() => normalizeFrontTagId("380024798"), /tag_…/);
});

test("builds tag conversation list paths for open statuses", () => {
  assert.equal(
    buildTagOpenConversationsPath("tag_Chief123", 25),
    "/tags/tag_Chief123/conversations?limit=25&q%5Bstatuses%5D%5B%5D=assigned&q%5Bstatuses%5D%5B%5D=unassigned",
  );
  assert.match(
    buildTagOpenConversationsPath("tag_Chief123", 10, "next_1"),
    /page_token=next_1/,
  );
  assert.equal(
    buildTagConversationsPath("tag_6a990e", 25, undefined, "all"),
    "/tags/tag_6a990e/conversations?limit=25",
  );
});

test("extracts Front pagination cursors", () => {
  assert.equal(
    pageTokenFromNext(
      "https://api2.frontapp.com/conversations/search/foo?page_token=next_123",
    ),
    "next_123",
  );
  assert.equal(pageTokenFromNext("opaque-token"), "opaque-token");
  assert.equal(pageTokenFromNext(null), null);
});

test("resolves one exact Front tag from API envelopes", () => {
  const tags = resultsFrom({
    _results: [
      { id: "tag_1", name: "chief inbox zero" },
      { id: "tag_2", name: "Chief Inbox Zero" },
    ],
  }).filter(
    (tag) =>
      typeof tag === "object" &&
      tag &&
      "name" in tag &&
      String(tag.name).toLowerCase() === "chief inbox zero",
  );
  assert.deepEqual(resolveExactTag(tags, "Chief Inbox Zero"), {
    id: "tag_2",
    name: "Chief Inbox Zero",
  });
  assert.throws(
    () => resolveExactTag([], "Missing"),
    /Front tag "Missing" was not found/,
  );
});

test("returns compact conversation data for Chief", () => {
  assert.deepEqual(
    compactConversation({
      id: "cnv_123",
      subject: "Pricing question",
      status: "assigned",
      status_category: "open",
      updated_at: 123,
      assignee: { first_name: "Jim", last_name: "Keough" },
      recipient: { name: "Customer" },
      tags: [{ id: "tag_Chief123", name: "Chief Inbox Zero" }],
      inboxes: [{ id: "inb_123", name: "Support" }],
      last_message: { blurb: "  Can you help?  " },
    }),
    {
      id: "cnv_123",
      subject: "Pricing question",
      status: "assigned",
      statusCategory: "open",
      updatedAt: 123,
      assignee: "Jim Keough",
      correspondent: "Customer",
      tags: [{ id: "tag_Chief123", name: "Chief Inbox Zero" }],
      inboxes: [{ id: "inb_123", name: "Support" }],
      preview: "Can you help?",
      link: "https://app.frontapp.com/open/cnv_123",
    },
  );
});
