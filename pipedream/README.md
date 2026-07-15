# Pipedream in Chief

Pipedream is the default connector path:

1. **MCP tools** — Calendar, Front list/get/write tools. Reads Auto; writes Ask.
2. **Connect API Proxy** — custom Front Core calls, especially
   [Front Search](https://dev.frontapp.com/docs/search-1):
   `GET /conversations/search/{query}` (e.g. `tag:tag_xxx is:open`).

## Front tagged inventory

`search_front_conversations`:

1. Resolve tag id via `tag_id` argument, Config **Front — Chief Inbox Zero tag id**
   (`front.inbox_zero_tag_id`), or name lookup (company `/tags` then
   teammate `/teammates/{id}/tags` — the teammate path is often rejected for
   private tags even when `/tags` works)
2. Call **Front Search API** via Proxy: `/conversations/search/tag:…%20is:open`
3. If Search fails, try `/tags/{id}/conversations`
4. If Proxy fails entirely, MCP `list-conversations` + client tag filter
   (recent ~100 only; includes `sampleTags` for name matching)

`diagnose_pipedream_connect` probes `/me`, company `/tags`, teammate
`/teammates/{tea}/tags` (when Config teammate id is set), and
`/conversations/search` separately — `/me` can succeed while Search or
teammate tags still fail.

### Finding `tag_…`

The numeric id in Front's tag settings URL is **not** the Core API id. Use:

- MCP `get-conversation` on a conversation that has the tag → `tags[].id`
- Front network tab when opening that tag in the UI

Config **Front — teammate id** = `tea_lm2n2` helps private-tag scoping on the
proxy path; Config **Front — Chief Inbox Zero tag id** skips name lookup.
