# Pipedream in Chief

Pipedream is the default connector path:

1. **MCP tools** — Calendar, Front list/get/write tools. Reads Auto; writes Ask.
2. **Connect API Proxy** — custom Front Core calls, especially
   [Front Search](https://dev.frontapp.com/docs/search-1):
   `GET /conversations/search/{query}` (e.g. `tag:tag_xxx is:open`).

## Front tagged inventory

`search_front_conversations`:

1. Resolve tag id (company `/tags` + teammate `/teammates/{id}/tags`)
2. Call **Front Search API** via Proxy: `/conversations/search/tag:…%20is:open`
3. If Search fails, try `/tags/{id}/conversations`
4. If Proxy fails entirely, MCP `list-conversations` + client tag filter
   (recent ~100 only; includes `sampleTags` for name matching)

`diagnose_pipedream_connect` probes `/me`, `/tags`, and `/conversations/search`
separately — `/me` can succeed while Search still fails.

Config **Front — teammate id** = `tea_lm2n2` helps private tags on the proxy path.
