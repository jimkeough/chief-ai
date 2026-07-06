// POST /api/accounts — the customer's connected Pipedream accounts.

import { authenticate, pdFetch, json } from "../lib/pd.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const externalUserId = authenticate(req);
  if (!externalUserId) return json(res, 401, { error: "Bad key" });
  try {
    const data = await pdFetch(
      `/accounts?external_user_id=${encodeURIComponent(externalUserId)}`,
    );
    const accounts = (data.data ?? [])
      .map((a) => ({
        id: a.id,
        app: a.app?.name_slug ?? a.app?.nameSlug ?? "",
        name: a.name,
        healthy: a.healthy !== false && a.dead !== true,
      }))
      .filter((a) => a.app);
    return json(res, 200, { accounts });
  } catch (e) {
    return json(res, 502, { error: e?.message ?? "Pipedream unavailable" });
  }
}
