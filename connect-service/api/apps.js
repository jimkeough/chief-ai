// POST /api/apps { q } — search Pipedream's app catalog (apps with components
// only — the ones usable as MCP tools), so users can find an app by name
// instead of knowing its slug.

import { authenticate, pdApiFetch, json } from "../lib/pd.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!authenticate(req)) return json(res, 401, { error: "Bad key" });
  const q = String(req.body?.q ?? "").trim();
  if (!q) return json(res, 200, { apps: [] });
  try {
    const data = await pdApiFetch(
      `/apps?q=${encodeURIComponent(q)}&has_components=1&limit=10`,
    );
    const apps = (data.data ?? []).map((a) => ({
      slug: a.name_slug ?? a.nameSlug,
      name: a.name,
      description: a.description,
      img: a.img_src ?? a.imgSrc,
    }));
    return json(res, 200, { apps: apps.filter((a) => a.slug) });
  } catch (e) {
    return json(res, 502, { error: e?.message ?? "Pipedream unavailable" });
  }
}
