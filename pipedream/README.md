# Pipedream in Chief

Pipedream is the default connector path:

1. **MCP tools** — Calendar, Front list/get/write tools. Reads Auto; writes Ask.
2. **Connect API Proxy** — custom Front Core calls, especially
   [Front Search](https://dev.frontapp.com/docs/search-1):
   `GET /conversations/search/{query}` (e.g. `tag:tag_xxx is:open`).

## Front tagged inventory

`search_front_conversations`:

1. Resolve tag id via `tag_id`, Config **Front — Chief Inbox Zero tag id**,
   or name lookup
2. **Primary for tags:** `GET /tags/{id}/conversations` — includes Front
   **discussions with no inbox** (Search API alone misses those)
3. If that fails (and Search fallback is allowed), fall back to inbox-scoped
   Search API
4. If Proxy fails entirely on open inventory, MCP `list-conversations`
   (also inbox-scoped / recent page only)

No `inbox` tool parameter — tag inventory is not scoped to an inbox.
Pass `status=all` for full tag inventory (not just open).

The **Inbox** page Front tab requires Config `front.inbox_zero_tag_id` and
uses this same tag list with **no Search fallback** (so a Proxy failure is
visible instead of a silent under-count). Email is a separate tab
(Gmail/IMAP today; Outlook later via the same source pattern).

### Private tags and Private Resources

Name lookup via `/teammates/{id}/tags` is often denied through Connect Proxy —
set Config **Front — Chief Inbox Zero tag id** to skip it.

If Front returns **"This agent is not allowed to read the tag"**, reconnecting
Pipedream's **default** Front app will not help — that client typically lacks
the **Private Resources** namespace. Two durable options:

1. **Convert the triage tag to company/shared** in Front (simplest).
2. **Custom Front OAuth client with Private Resources:**
   - Front → Settings → Developers → create an OAuth app with **Private
     Resources** (and Tags + Conversations read)
   - Pipedream → OAuth Clients → New → Front → paste that client id/secret;
     keep Private Resources in the client scopes
   - Copy the Pipedream client id (`oa_…`) into Chief Config → **Pipedream —
     Front OAuth app id**
   - Config → Connections → disconnect Front, then connect Front again (the
     connect link includes `oauthAppId`)

Chief tagged-search tools do **not** fall back to inbox-scoped Search (that
path under-counts). Relative Connect Proxy paths can also 403 while absolute
api2 works; Inbox prefers absolute. Teammate preference denials use a different
Front message — see https://help.front.com/en/articles/2516.

`diagnose_pipedream_connect` probes `/me`, company `/tags`, teammate
`/teammates/{tea}/tags` (when Config teammate id is set), configured tag
conversations (relative + absolute), and `/conversations/search` separately.

### Finding `tag_…`

The numeric id in Front's tag settings URL is **not** the Core API id. Use:

- MCP `get-conversation` on a conversation that has the tag → `tags[].id`
- Front network tab when opening that tag in the UI

Config **Front — teammate id** = `tea_lm2n2` helps private-tag scoping on the
proxy path; Config **Front — Chief Inbox Zero tag id** skips name lookup.
