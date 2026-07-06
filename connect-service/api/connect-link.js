// POST /api/connect-link — a short-lived hosted Connect Link for this
// customer's managed-OAuth flow. The app appends &app=<slug> to target one app.

import { authenticate, pdFetch, json } from "../lib/pd.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const externalUserId = authenticate(req);
  if (!externalUserId) return json(res, 401, { error: "Bad key" });
  try {
    const data = await pdFetch("/tokens", {
      method: "POST",
      body: { external_user_id: externalUserId },
    });
    return json(res, 200, {
      token: data.token,
      expiresAt: data.expires_at,
      connectLinkUrl: data.connect_link_url,
    });
  } catch (e) {
    return json(res, 502, { error: e?.message ?? "Pipedream unavailable" });
  }
}
