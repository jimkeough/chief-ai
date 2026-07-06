// POST /api/mcp-token — everything a Chief deployment needs to call the
// Pipedream MCP servers for ITS OWN connectors: a short-lived project access
// token plus the project/environment/externalUserId that parameterize the
// MCP URL. The externalUserId comes from the customer's key, never the body.

import { authenticate, pdAccessToken, pdProjectId, pdEnvironment, json } from "../lib/pd.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const externalUserId = authenticate(req);
  if (!externalUserId) return json(res, 401, { error: "Bad key" });
  try {
    const { token, exp } = await pdAccessToken();
    return json(res, 200, {
      accessToken: token,
      expiresAt: new Date(exp).toISOString(),
      projectId: pdProjectId(),
      environment: pdEnvironment(),
      externalUserId,
    });
  } catch (e) {
    return json(res, 502, { error: e?.message ?? "Pipedream unavailable" });
  }
}
