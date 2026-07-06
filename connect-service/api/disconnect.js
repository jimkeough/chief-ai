// POST /api/disconnect { accountId } — delete one connected account, after
// verifying it belongs to THIS customer (default-deny across tenants).

import { authenticate, pdFetch, json } from "../lib/pd.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const externalUserId = authenticate(req);
  if (!externalUserId) return json(res, 401, { error: "Bad key" });
  const accountId = String(req.body?.accountId ?? "").trim();
  if (!accountId) return json(res, 400, { error: "accountId required" });
  try {
    const data = await pdFetch(
      `/accounts?external_user_id=${encodeURIComponent(externalUserId)}`,
    );
    const owns = (data.data ?? []).some((a) => a.id === accountId);
    if (!owns) return json(res, 404, { error: "Not your account" });
    await pdFetch(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 502, { error: e?.message ?? "Pipedream unavailable" });
  }
}
