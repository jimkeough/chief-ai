// Trigger management for Proactive Chief. Four actions on one endpoint (keyed
// by `action` in the body), all scoped to the caller's external user:
//   list-components { app }     → the app's deployable trigger components
//   deploy { id, configuredProps, webhookUrl } → deploy a trigger to a webhook
//   list                        → the user's deployed triggers
//   delete { triggerId }        → remove one (ownership-checked)
//
// The Chief deployment passes its OWN webhook URL on deploy; Pipedream returns
// a signing key the app stores to verify incoming event deliveries.

import { authenticate, pdApiFetch, pdFetch, json } from "../lib/pd.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const externalUserId = authenticate(req);
  if (!externalUserId) return json(res, 401, { error: "Bad key" });

  const action = String(req.body?.action ?? "").trim();
  try {
    if (action === "list-components") {
      const app = String(req.body?.app ?? "").trim();
      if (!app) return json(res, 400, { error: "app required" });
      // Trigger-type components for the app.
      const data = await pdApiFetch(
        `/components?app=${encodeURIComponent(app)}&component_type=trigger&limit=30`,
      );
      const components = (data.data ?? []).map((c) => ({
        id: c.key ?? c.id,
        name: c.name,
        description: c.description,
      }));
      return json(res, 200, { components });
    }

    if (action === "deploy") {
      const id = String(req.body?.id ?? "").trim();
      const webhookUrl = String(req.body?.webhookUrl ?? "").trim();
      if (!id || !webhookUrl) {
        return json(res, 400, { error: "id and webhookUrl required" });
      }
      const data = await pdFetch(`/triggers/deploy`, {
        method: "POST",
        body: {
          id,
          external_user_id: externalUserId,
          webhook_url: webhookUrl,
          configured_props: req.body?.configuredProps ?? {},
        },
      });
      const d = data.data ?? data;
      return json(res, 200, {
        id: d.id,
        name: d.name,
        signingKey: d.webhook_signing_key ?? null,
      });
    }

    if (action === "list") {
      const data = await pdFetch(
        `/deployed-triggers?external_user_id=${encodeURIComponent(externalUserId)}`,
      );
      const triggers = (data.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        componentId: t.component_id ?? t.component_key,
        active: t.active !== false,
      }));
      return json(res, 200, { triggers });
    }

    if (action === "delete") {
      const triggerId = String(req.body?.triggerId ?? "").trim();
      if (!triggerId) return json(res, 400, { error: "triggerId required" });
      // Ownership check: the trigger must belong to this external user.
      const list = await pdFetch(
        `/deployed-triggers?external_user_id=${encodeURIComponent(externalUserId)}`,
      );
      const owns = (list.data ?? []).some((t) => t.id === triggerId);
      if (!owns) return json(res, 404, { error: "Not your trigger" });
      await pdFetch(
        `/deployed-triggers/${encodeURIComponent(triggerId)}?external_user_id=${encodeURIComponent(externalUserId)}`,
        { method: "DELETE" },
      );
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: "Unknown action" });
  } catch (e) {
    return json(res, 502, { error: e?.message ?? "Pipedream unavailable" });
  }
}
