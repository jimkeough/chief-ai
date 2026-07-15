# Pipedream in Chief

Pipedream is Chief's managed connector path for apps that do not have a
dedicated first-party integration. The owner supplies a Pipedream Connect
project and OAuth client; Chief stores those project credentials in Supabase
Vault and uses Pipedream's hosted Connect Link for each account.

Each connected account becomes an app/account-scoped remote MCP server. Managed
read annotations may run automatically; writes, sends, deletes, and unknown
tools always require Chief's approval flow. Optional Pipedream triggers can
queue suggestions but cannot execute actions.

## Front is not a Pipedream connector

Chief's Front Inbox, conversation search, detail reads, and Front actions use
[Front's official MCP server](https://dev.frontapp.com/docs/mcp-server)
directly. Configure it under **Settings → Connections → Front · Official MCP**.
The legacy Pipedream Front proxy code remains temporarily for compatibility and
diagnostics, but it is not used by Chief's Front Inbox or native Front search
tools.
