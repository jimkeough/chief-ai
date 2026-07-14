import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPipedreamMcpServerConfig,
  PIPEDREAM_MCP_REGISTRY,
} from "../lib/pipedream-mcp-config.ts";
import {
  buildTaggedOpenQuery,
  compactConversation,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
} from "../pipedream/components/frontapp/search-tagged-open-conversations.helpers.mjs";

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

test("builds an exact tagged-open Front query", () => {
  assert.equal(
    buildTaggedOpenQuery("tag_Chief123"),
    "tag:tag_Chief123 is:open",
  );
  assert.throws(() => buildTaggedOpenQuery("380024798"), /invalid tag ID/);
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
    (tag) => tag.name.toLowerCase() === "chief inbox zero".toLowerCase(),
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
