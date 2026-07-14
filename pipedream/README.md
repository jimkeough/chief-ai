# Chief custom Pipedream tools

Chief requests Pipedream's public and private MCP registries. Private actions
published to the same Connect project and environment therefore appear under
the connected app's **Tools** menu and use that account's existing managed
authentication.

Custom tools require a Pipedream Business plan and the Pipedream CLI.

## Front: tagged open conversations

`components/frontapp/search-tagged-open-conversations.mjs` resolves an exact
Front tag name, searches the Front Core API for open conversations carrying
that tag, and returns compact pages to Chief. It does not modify Front.

1. Install and authenticate the Pipedream CLI by following
   [Pipedream's action quickstart](https://pipedream.com/docs/components/contributing/actions-quickstart),
   then run `pd login`.
2. From this repository, publish to the environment selected in
   **Chief → Config → Connections → Pipedream**:

   ```sh
   pd publish pipedream/components/frontapp/search-tagged-open-conversations.mjs \
     --connect-environment production
   ```

   Use `development` instead when Chief's Pipedream configuration uses that
   environment.
3. Wait about a minute for Chief's MCP tool cache, then expand
   **Config → Connections → Front → Tools**.
4. Set **Search Tagged Open Conversations** to **Auto**. Keep Front write tools
   such as archive, assign, tag, comment, and draft reply on **Ask**.
5. Ask Chief:

   > Search every open Front conversation tagged "Chief Inbox Zero". Follow
   > `nextCursor` until `hasMore` is false. Make no Front changes. Report the
   > final count, then triage the oldest 10 conversations.

The action uses Pipedream's existing Front OAuth grant. Do not paste a Front API
token into the component, Chief, source control, or chat.
