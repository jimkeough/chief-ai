// GET / and /api/health — a friendly liveness check so the root of the
// service isn't a bare 404. No auth, no secrets: just "I'm here" plus which
// env vars are present (booleans only).

import { json } from "../lib/pd.js";

export default async function handler(_req, res) {
  return json(res, 200, {
    ok: true,
    service: "chief-connect",
    configured: {
      pipedream_client: Boolean(
        process.env.PIPEDREAM_CLIENT_ID && process.env.PIPEDREAM_CLIENT_SECRET,
      ),
      project_id: Boolean(process.env.PIPEDREAM_PROJECT_ID),
      environment: process.env.PIPEDREAM_ENVIRONMENT === "production"
        ? "production"
        : "development",
      keys_issued: (process.env.CONNECT_KEYS ?? "")
        .split(",")
        .filter((p) => p.includes(":")).length,
    },
  });
}
