import { axios } from "@pipedream/platform";
import {
  buildTaggedOpenQuery,
  compactConversation,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
} from "./search-tagged-open-conversations.helpers.mjs";

const API = "https://api2.frontapp.com";

async function frontRequest($, token, path, params = {}) {
  return axios($, {
    method: "GET",
    url: `${API}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    params,
  });
}

async function resolveTag($, token, requestedName) {
  const matches = [];
  const seenPageTokens = new Set();
  let pageToken = null;
  do {
    const response = await frontRequest($, token, "/tags", {
      limit: 100,
      ...(pageToken ? { page_token: pageToken } : {}),
    });
    for (const tag of resultsFrom(response)) {
      if (
        typeof tag?.name === "string" &&
        tag.name.trim().toLowerCase() === requestedName.toLowerCase()
      ) {
        matches.push(tag);
      }
    }
    pageToken = pageTokenFromNext(response?._pagination?.next);
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error("Front repeated a tag pagination cursor.");
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return resolveExactTag(matches, requestedName);
}

export default {
  key: "frontapp-search-tagged-open-conversations",
  name: "Search Tagged Open Conversations",
  description:
    "Return one compact, paginated page of open Front conversations carrying an exact tag. Use the returned cursor until hasMore is false.",
  version: "0.0.1",
  type: "action",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  props: {
    frontapp: {
      type: "app",
      app: "frontapp",
    },
    tagName: {
      type: "string",
      label: "Tag Name",
      description: "Exact Front tag name used to scope the search.",
      default: "Chief Inbox Zero",
    },
    limit: {
      type: "integer",
      label: "Page Size",
      description: "Conversations to return in this page.",
      default: 25,
      min: 1,
      max: 100,
    },
    cursor: {
      type: "string",
      label: "Cursor",
      description: "Cursor returned by the preceding call.",
      optional: true,
    },
  },
  async run({ $ }) {
    const tagName = this.tagName.trim();
    if (!tagName) throw new Error("Enter the exact Front tag name.");
    const token = this.frontapp.$auth.oauth_access_token;
    const tag = await resolveTag($, token, tagName);
    const query = buildTaggedOpenQuery(tag.id);
    const response = await frontRequest(
      $,
      token,
      `/conversations/search/${encodeURIComponent(query)}`,
      {
        limit: this.limit,
        ...(this.cursor ? { page_token: this.cursor } : {}),
      },
    );
    const nextCursor = pageTokenFromNext(response?._pagination?.next);
    const conversations = resultsFrom(response).map(compactConversation);
    $.export(
      "$summary",
      `Found ${conversations.length} open conversation${conversations.length === 1 ? "" : "s"} tagged "${tag.name}".`,
    );
    return {
      tag: { id: tag.id, name: tag.name },
      count: conversations.length,
      total:
        typeof response?._total === "number" ? response._total : undefined,
      conversations,
      nextCursor,
      hasMore: Boolean(nextCursor),
    };
  },
};
