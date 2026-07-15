# Pipedream in Chief

Pipedream is the default connector path:

1. **MCP tools** — each connected account exposes that app's prebuilt actions
   through Pipedream's remote MCP. Reads default to Auto; writes stay on Ask.
2. **Connect API Proxy** — when a prebuilt action is missing or too narrow,
   Chief can call the upstream API through Pipedream with the same managed
   OAuth grant (`pipedreamProxyRequest` in `lib/pipedream.ts`).

## Front conversation inventory

Front's public Pipedream `list-conversations` action cannot filter by tag,
inbox, or assignee. Chief therefore searches with the native read tool
`search_front_conversations` (`lib/front-search.ts`), which:

- resolves the Front teammate from, in order: tool `teammate` arg, Config
  setting `front.teammate_id`, then Front `GET /me` (when the proxy allows it)
- looks up tags on both `/tags` and `/teammates/{id}/tags`
- for a tag filter, lists `/tags/{id}/conversations` (same path as Front's tag
  view) with open statuses
- without a tag, searches `is:open` scoped to that teammate as participant by
  default
- returns compact, paginated results for triage

If inventory fails on teammate identity, set **Config → Front — teammate id**
once (e.g. `tea_36301790`). You do not need to paste it into every chat.

No Front API token is stored in Chief. After inventory, use Front MCP tools to
read details and propose writes (archive, assign, tag, comment, draft reply).
Keep those write tools on **Ask** (not Off).

Example ask:

> Search open Front conversations tagged "Chief Inbox Zero". Follow
> `nextCursor` until `hasMore` is false. Make no Front changes. Report the
> final count, then triage the oldest 10.
