import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFrontMcpSearchArgs,
  frontMcpConversationDetail,
  frontMcpConversations,
  frontMcpNextCursor,
  parseFrontMcpJson,
} from "../lib/front-mcp-read-helpers.ts";
import {
  FRONT_OAUTH_SCOPE,
  frontAuthorizationScope,
  frontOAuthScopeString,
  frontRedirectUri,
  normalizeFrontScopes,
} from "../lib/front-oauth-helpers.ts";

test("builds the Front OAuth callback and uses feature:mcp", () => {
  assert.equal(
    frontRedirectUri("https://chief.example.com/"),
    "https://chief.example.com/api/front/callback",
  );
  assert.equal(FRONT_OAUTH_SCOPE, "feature:mcp");
  assert.equal(frontOAuthScopeString(), "feature:mcp");
  assert.deepEqual(normalizeFrontScopes(["send", "read", "write"]), [
    "feature:mcp",
  ]);
  assert.deepEqual(normalizeFrontScopes(["feature:mcp"]), ["feature:mcp"]);
  assert.throws(
    () => normalizeFrontScopes(["openid"]),
    /only supports the "feature:mcp" scope/,
  );
});

test("requests the scope Front's live metadata advertises", () => {
  // Mirrors whatever the authorization server advertises...
  assert.equal(frontAuthorizationScope(["feature:mcp"]), "feature:mcp");
  assert.equal(
    frontAuthorizationScope(["read", "write", "send"]),
    "read write send",
  );
  // ...and falls back to the known MCP scope when metadata omits it.
  assert.equal(frontAuthorizationScope([]), "feature:mcp");
  assert.equal(frontAuthorizationScope(undefined), "feature:mcp");
  assert.equal(frontAuthorizationScope("read"), "feature:mcp");
});

test("builds official Front MCP tag searches", () => {
  assert.deepEqual(
    buildFrontMcpSearchArgs({
      tagId: "tag_6a990e",
      status: "open",
      cursor: "next-1",
    }),
    {
      scope: "all_inboxes",
      filters: { tags: ["tag_6a990e"], status: "open" },
      cursor: "next-1",
    },
  );
  assert.deepEqual(
    buildFrontMcpSearchArgs({ tagId: "tag_6a990e", status: "all" }),
    {
      scope: "all_inboxes",
      filters: { tags: ["tag_6a990e"] },
    },
  );
  assert.throws(
    () => buildFrontMcpSearchArgs({ status: "assigned" }),
    /cannot filter status "assigned"/,
  );
});

test("parses official MCP search results and cursors", () => {
  const parsed = parseFrontMcpJson(`\`\`\`json
  {
    "conversations": [{
      "id": "cnv_123",
      "subject": "Pricing question",
      "status": "open",
      "statusCategory": "open",
      "updatedAt": "2026-07-15T20:00:00Z",
      "correspondent": "Customer",
      "tags": [{"id": "tag_6a990e", "name": "Chief Inbox Zero"}],
      "inboxes": [{"id": "inb_1", "name": "Support"}],
      "preview": "Can you help?"
    }],
    "nextCursor": "cursor-2"
  }
  \`\`\``);
  assert.equal(frontMcpNextCursor(parsed), "cursor-2");
  assert.deepEqual(frontMcpConversations(parsed), [
    {
      id: "cnv_123",
      subject: "Pricing question",
      status: "open",
      statusCategory: "open",
      updatedAt: "2026-07-15T20:00:00Z",
      assignee: "",
      correspondent: "Customer",
      tags: [{ id: "tag_6a990e", name: "Chief Inbox Zero" }],
      inboxes: [{ id: "inb_1", name: "Support" }],
      preview: "Can you help?",
      link: "https://app.frontapp.com/open/cnv_123",
    },
  ]);
});

test("maps an official read_conversation timeline into Inbox detail", () => {
  const detail = frontMcpConversationDetail({
    conversation: {
      id: "cnv_123",
      subject: "Pricing question",
      status: "open",
      tags: [{ id: "tag_6a990e", name: "Chief Inbox Zero" }],
    },
    timeline: [
      {
        type: "message",
        message: {
          body: "Earlier message",
          createdAt: "2026-07-15T19:00:00Z",
        },
      },
      {
        type: "message",
        message: {
          body: "Latest customer question",
          createdAt: "2026-07-15T20:00:00Z",
          author: { name: "Customer" },
        },
      },
    ],
  });
  assert.equal(detail.id, "cnv_123");
  assert.equal(detail.body, "Latest customer question");
  assert.equal(detail.preview, "Latest customer question");
  assert.equal(detail.correspondent, "Customer");
});
