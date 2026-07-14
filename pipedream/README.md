# Pipedream in Chief

Pipedream is the default connector path:

1. **MCP tools** — each connected account exposes that app's prebuilt actions
   through Pipedream's remote MCP. Reads default to Auto; writes stay on Ask.
2. **Connect API Proxy** — when a prebuilt action is missing or too narrow,
   Chief can call the upstream API through Pipedream with the same managed
   OAuth grant (`pipedreamProxyRequest` in `lib/pipedream.ts`).

## Front tagged search

Front's public Pipedream `list-conversations` action cannot filter by tag.
Chief therefore searches open tagged conversations with the native read tool
`search_front_tagged_conversations` (`lib/front-search.ts`), which:

- resolves the exact tag name (default `Chief Inbox Zero`)
- calls Front Core API `GET /conversations/search/{tag:ID is:open}` through
  Connect Proxy
- returns compact, paginated results for triage

No Front API token is stored in Chief. No private Pipedream action publish
step is required. After inventory, use Front MCP tools to read details and
propose writes (archive, assign, tag, comment, draft reply).

Example ask:

> Search every open Front conversation tagged "Chief Inbox Zero". Follow
> `nextCursor` until `hasMore` is false. Make no Front changes. Report the
> final count, then triage the oldest 10 conversations.
