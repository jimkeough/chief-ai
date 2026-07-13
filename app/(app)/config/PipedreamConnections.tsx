"use client";

import { useCallback, useEffect, useState } from "react";

type Config = {
  configured: boolean;
  projectId: string | null;
  environment: "development" | "production" | null;
};

type App = {
  slug: string;
  name: string;
  description: string | null;
};

type Connection = {
  id: string;
  accountId: string;
  appSlug: string;
  appName: string;
  accountName: string | null;
  healthy: boolean;
  serverName: string;
};

type ServerTool = {
  name: string;
  description: string;
  readOnly: boolean;
  mode: "auto" | "ask" | "off";
};

type TriggerComponent = {
  id: string;
  name: string;
  description: string | null;
  supported: boolean;
  unsupportedReason: string | null;
  configProps: TriggerConfigProp[];
};

type TriggerConfigProp = {
  name: string;
  label: string;
  description: string | null;
  multiple: boolean;
  required: boolean;
  options: Array<{ label: string; value: string }>;
};

type DeployedTrigger = {
  id: string;
  componentId: string | null;
  name: string | null;
};

type NotificationData = {
  components: TriggerComponent[];
  deployed: DeployedTrigger[];
};

type Draft = {
  projectId: string;
  clientId: string;
  clientSecret: string;
  environment: "development" | "production";
};

const emptyDraft = (): Draft => ({
  projectId: "",
  clientId: "",
  clientSecret: "",
  environment: "development",
});

const inputClass =
  "w-full rounded-control border bg-transparent px-3 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-3";

function ToolModes({
  server,
  tools,
  busy,
  onChange,
}: {
  server: string;
  tools: ServerTool[];
  busy: boolean;
  onChange: (server: string, tool: string, mode: "auto" | "ask" | "off") => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-control border p-3"
      style={{ borderColor: "var(--hairline)" }}
    >
      {tools.map((tool) => (
        <div key={tool.name} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px] text-ink">{tool.name}</div>
            <div className="truncate text-[11.5px] text-ink-3">
              {tool.readOnly ? "verified read" : "always asks"}
            </div>
          </div>
          {(tool.readOnly
            ? (["auto", "ask", "off"] as const)
            : (["ask", "off"] as const)
          ).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(server, tool.name, mode)}
              disabled={busy}
              className="rounded-chip border px-2 py-1 font-mono text-[10px] tracking-[0.06em] disabled:opacity-50"
              style={
                tool.mode === mode
                  ? {
                      background: "var(--teal-fill)",
                      color: "var(--teal-on-fill)",
                      borderColor: "transparent",
                    }
                  : { borderColor: "var(--hairline)", color: "var(--ink-3)" }
              }
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      ))}
      {tools.length === 0 && (
        <div className="text-[13px] text-ink-3">No tools exposed.</div>
      )}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ background: ok ? "var(--ok)" : "var(--copper)" }}
      aria-hidden="true"
    />
  );
}

const SETUP_STEPS = [
  {
    title: "Create a Chief project",
    body: "In Pipedream Projects, choose New project and name it Chief. One project will hold every app you connect.",
    action: "Open Pipedream projects",
  },
  {
    title: "Copy the project ID",
    body: "Open the Chief project, choose Connect, and copy the Project ID from Configuration. It begins with proj_.",
    action: "Project → Connect",
  },
  {
    title: "Create an OAuth client",
    body: "Open workspace Settings → API → New OAuth Client. Name it Chief, then copy both values before closing—the secret is shown once.",
    action: "Settings → API",
  },
  {
    title: "Paste and verify",
    body: "Return here, paste the project ID, client ID, and client secret, then keep Development selected for dogfooding.",
    action: "Enter credentials",
  },
] as const;

function SetupIllustration({ step }: { step: number }) {
  const panelStyle = {
    borderColor: "color-mix(in srgb, var(--hairline) 75%, transparent)",
    background: "color-mix(in srgb, var(--surface) 88%, #eef3f6)",
  } as const;
  const selectedStyle = {
    background: "color-mix(in srgb, var(--teal-fill) 16%, var(--surface))",
    color: "var(--teal)",
  } as const;
  const blue = "#138be5";

  return (
    <div
      className="overflow-hidden rounded-control border text-[9px] text-ink-3"
      style={panelStyle}
      aria-hidden="true"
    >
      <div
        className="flex h-7 items-center gap-1.5 border-b px-2"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b65]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#f4c95d]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#65c98a]" />
        <span className="ml-1 font-semibold text-ink-2">Pipedream</span>
      </div>

      {step === 0 && (
        <div className="h-[148px] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink">Projects</span>
            <span
              className="rounded px-2.5 py-1.5 font-semibold text-white"
              style={{ background: blue }}
            >
              + New project
            </span>
          </div>
          <div
            className="mx-auto mt-5 w-[88%] rounded border p-3 shadow-sm"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div className="text-[11px] font-semibold text-ink">New Project</div>
            <div className="mt-2 text-ink-3">Name</div>
            <div
              className="mt-1 rounded border px-2 py-1.5 text-[10px] font-medium text-ink"
              style={{ borderColor: blue }}
            >
              Chief
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex h-[148px]">
          <div
            className="w-[31%] border-r p-2"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            {["Resources", "Access", "Connect", "Settings"].map((item) => (
              <div
                key={item}
                className="mb-1 rounded px-1.5 py-1.5"
                style={item === "Connect" ? selectedStyle : undefined}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="flex-1 p-3">
            <div className="text-[11px] font-semibold text-ink">Connect</div>
            <div className="mt-3 rounded border p-2" style={{ borderColor: "var(--hairline)" }}>
              <div className="font-semibold text-ink-2">Configuration</div>
              <div className="mt-2">Project ID</div>
              <div
                className="mt-1 flex items-center justify-between rounded border px-2 py-1.5 font-mono text-ink"
                style={{ borderColor: blue, background: "var(--surface)" }}
              >
                <span>proj_••••••</span>
                <span>⧉</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex h-[148px]">
          <div
            className="w-[34%] border-r p-2"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div className="mb-1 font-semibold text-ink-2">Workspace settings</div>
            {["General", "Authentication", "API"].map((item) => (
              <div
                key={item}
                className="mb-1 rounded px-1.5 py-1.5"
                style={item === "API" ? selectedStyle : undefined}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="flex-1 p-3">
            <div className="text-[11px] font-semibold text-ink">Pipedream API</div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-ink-2">OAuth Clients</div>
                <div className="mt-1">Create API credentials</div>
              </div>
              <span
                className="rounded px-2 py-1.5 font-semibold text-white"
                style={{ background: blue }}
              >
                + New OAuth Client
              </span>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="h-[148px] p-3">
          <div
            className="mx-auto w-[92%] rounded border p-3 shadow-sm"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div className="text-[11px] font-semibold text-ink">
              Chief · Pipedream setup
            </div>
            {["Project ID", "Client ID", "Client secret"].map((label) => (
              <div key={label} className="mt-2">
                <div>{label}</div>
                <div
                  className="mt-0.5 h-5 rounded border"
                  style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PipedreamSetupWalkthrough() {
  const [step, setStep] = useState(0);
  const current = SETUP_STEPS[step];

  const advance = () => {
    if (step < SETUP_STEPS.length - 1) {
      setStep((value) => value + 1);
      return;
    }
    document.getElementById("pipedream-project-id")?.focus();
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-control border p-3"
      style={{
        borderColor: "var(--teal-border)",
        background: "color-mix(in srgb, var(--teal-fill) 5%, var(--surface))",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.1em] text-teal">
          STEP {step + 1} OF {SETUP_STEPS.length}
        </span>
        <div className="flex gap-1" aria-hidden="true">
          {SETUP_STEPS.map((item, index) => (
            <span
              key={item.title}
              className="h-1.5 rounded-full transition-[width]"
              style={{
                width: index === step ? 18 : 6,
                background: index <= step ? "var(--teal)" : "var(--hairline)",
              }}
            />
          ))}
        </div>
      </div>

      <div aria-live="polite">
        <div className="text-[15px] font-semibold text-ink">{current.title}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{current.body}</p>
      </div>

      <SetupIllustration step={step} />

      <div className="flex items-center gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((value) => value - 1)}
            className="h-9 rounded-control border px-3 text-[12.5px] text-ink-2"
            style={{ borderColor: "var(--hairline)" }}
          >
            Back
          </button>
        )}
        {step === 0 && (
          <a
            href="https://pipedream.com/projects"
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 rounded-control border px-3 py-2 text-[12px] font-semibold text-teal"
            style={{ borderColor: "var(--teal-border)" }}
          >
            Open Pipedream ↗
          </a>
        )}
        <button
          type="button"
          onClick={advance}
          className="ml-auto h-9 rounded-control px-3.5 text-[12.5px] font-semibold"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          {step === SETUP_STEPS.length - 1 ? "Enter credentials ↓" : "Next"}
        </button>
      </div>
    </div>
  );
}

export default function PipedreamConnections() {
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  const [tools, setTools] = useState<ServerTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const [notificationsFor, setNotificationsFor] = useState<string | null>(null);
  const [notificationData, setNotificationData] = useState<NotificationData | null>(
    null,
  );
  const [notificationBusy, setNotificationBusy] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationNeedsMigration, setNotificationNeedsMigration] =
    useState(false);
  const [notificationConfig, setNotificationConfig] = useState<
    Record<string, Record<string, string[]>>
  >({});

  const loadConnections = useCallback(async () => {
    const response = await fetch("/api/pipedream/connections");
    const body = (await response.json().catch(() => ({}))) as {
      connections?: Connection[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Couldn't load connections.");
    setConnections(body.connections ?? []);
  }, []);

  const loadTools = async (server: string) => {
    if (toolsFor === server) {
      setToolsFor(null);
      setTools(null);
      return;
    }
    setToolsFor(server);
    setTools(null);
    setToolsError(null);
    const response = await fetch(
      `/api/mcp/tools?server=${encodeURIComponent(server)}`,
    ).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      tools?: ServerTool[];
      error?: string;
    };
    if (response?.ok && body.ok) setTools(body.tools ?? []);
    else setToolsError(body.error ?? "Couldn't list tools.");
  };

  const setToolMode = async (
    server: string,
    tool: string,
    mode: "auto" | "ask" | "off",
  ) => {
    if (toolBusy) return;
    setToolBusy(true);
    setToolsError(null);
    const previous = tools;
    setTools(
      (current) =>
        current?.map((item) => (item.name === tool ? { ...item, mode } : item)) ??
        null,
    );
    const response = await fetch("/api/mcp/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server, tool, mode }),
    }).catch(() => null);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string };
      setTools(previous);
      setToolsError(body.error ?? "Couldn't update that tool.");
    }
    setToolBusy(false);
  };

  const fetchNotifications = async (
    connectionId: string,
  ): Promise<NotificationData | null> => {
    const response = await fetch(
      `/api/pipedream/connections/${encodeURIComponent(connectionId)}/triggers`,
    ).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as NotificationData & {
      ok?: boolean;
      error?: string;
      migrationRequired?: boolean;
    };
    if (!response?.ok || !body.ok) {
      setNotificationNeedsMigration(body.migrationRequired === true);
      setNotificationError(body.error ?? "Couldn't list notifications.");
      return null;
    }
    setNotificationNeedsMigration(false);
    setNotificationError(null);
    return {
      components: body.components ?? [],
      deployed: body.deployed ?? [],
    };
  };

  const loadNotifications = async (connectionId: string) => {
    if (notificationBusy) return;
    if (notificationsFor === connectionId) {
      setNotificationsFor(null);
      setNotificationData(null);
      setNotificationNeedsMigration(false);
      return;
    }
    setNotificationsFor(connectionId);
    setNotificationData(null);
    setNotificationError(null);
    setNotificationNeedsMigration(false);
    setNotificationBusy(`load:${connectionId}`);
    try {
      setNotificationData(await fetchNotifications(connectionId));
    } finally {
      setNotificationBusy(null);
    }
  };

  const applyNotificationMigration = async (connectionId: string) => {
    const busyKey = `migration:${connectionId}`;
    if (notificationBusy) return;
    setNotificationBusy(busyKey);
    setNotificationError(null);
    try {
      const response = await fetch("/api/setup/migrate", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setNotificationError(body.error ?? "Couldn't apply the database update.");
        return;
      }
      setNotificationNeedsMigration(false);
      const fresh = await fetchNotifications(connectionId);
      if (fresh) setNotificationData(fresh);
    } catch {
      setNotificationError("Couldn't apply the database update.");
    } finally {
      setNotificationBusy(null);
    }
  };

  const toggleNotificationOption = (
    connectionId: string,
    component: TriggerComponent,
    prop: TriggerConfigProp,
    value: string,
  ) => {
    const key = `${connectionId}:${component.id}`;
    setNotificationConfig((current) => {
      const componentConfig = current[key] ?? {};
      const selected = componentConfig[prop.name] ?? [];
      const next = prop.multiple
        ? selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value]
        : [value];
      return {
        ...current,
        [key]: { ...componentConfig, [prop.name]: next },
      };
    });
  };

  const enableNotification = async (
    connectionId: string,
    component: TriggerComponent,
  ) => {
    const busyKey = `${connectionId}:${component.id}`;
    const config = notificationConfig[busyKey] ?? {};
    const configuredProps = Object.fromEntries(
      component.configProps.flatMap((prop) => {
        const selected = config[prop.name] ?? [];
        if (selected.length === 0) return [];
        return [[prop.name, prop.multiple ? selected : selected[0]]];
      }),
    );
    setNotificationBusy(busyKey);
    setNotificationError(null);
    const temporaryId = `pending:${component.id}`;
    setNotificationData((current) =>
      current
        ? {
            ...current,
            deployed: [
              ...current.deployed,
              { id: temporaryId, componentId: component.id, name: component.name },
            ],
          }
        : current,
    );
    const response = await fetch(
      `/api/pipedream/connections/${encodeURIComponent(connectionId)}/triggers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentId: component.id, configuredProps }),
      },
    ).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      id?: string;
      error?: string;
    };
    setNotificationBusy(null);
    if (!response?.ok || !body.ok || !body.id) {
      setNotificationData((current) =>
        current
          ? {
              ...current,
              deployed: current.deployed.filter((item) => item.id !== temporaryId),
            }
          : current,
      );
      setNotificationError(body.error ?? "Couldn't turn on that notification.");
      return;
    }
    setNotificationData((current) =>
      current
        ? {
            ...current,
            deployed: current.deployed.map((item) =>
              item.id === temporaryId ? { ...item, id: body.id! } : item,
            ),
          }
        : current,
    );
    const fresh = await fetchNotifications(connectionId);
    if (fresh) setNotificationData(fresh);
  };

  const disableNotification = async (
    connectionId: string,
    trigger: DeployedTrigger,
  ) => {
    const busyKey = `${connectionId}:${trigger.id}`;
    setNotificationBusy(busyKey);
    setNotificationError(null);
    setNotificationData((current) =>
      current
        ? {
            ...current,
            deployed: current.deployed.filter((item) => item.id !== trigger.id),
          }
        : current,
    );
    const response = await fetch(
      `/api/pipedream/connections/${encodeURIComponent(connectionId)}/triggers?trigger=${encodeURIComponent(trigger.id)}`,
      { method: "DELETE" },
    ).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    setNotificationBusy(null);
    if (!response?.ok || !body.ok) {
      setNotificationData((current) =>
        current && !current.deployed.some((item) => item.id === trigger.id)
          ? { ...current, deployed: [...current.deployed, trigger] }
          : current,
      );
      setNotificationError(body.error ?? "Couldn't turn off that notification.");
      return;
    }
    const fresh = await fetchNotifications(connectionId);
    if (fresh) setNotificationData(fresh);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pipedream/config");
      const body = (await response.json().catch(() => ({}))) as {
        config?: Config;
        error?: string;
      };
      if (!response.ok || !body.config) {
        throw new Error(body.error ?? "Couldn't load Pipedream setup.");
      }
      setConfig(body.config);
      if (body.config.configured) {
        await loadConnections();
      } else {
        setDraft(emptyDraft());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load Pipedream setup.");
    } finally {
      setLoading(false);
    }
  }, [loadConnections]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveConfig = async () => {
    if (!draft || busy) return;
    setBusy("setup");
    setError(null);
    try {
      const response = await fetch("/api/pipedream/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json().catch(() => ({}))) as {
        config?: Config;
        error?: string;
      };
      if (!response.ok || !body.config) {
        throw new Error(body.error ?? "Couldn't verify Pipedream setup.");
      }
      setConfig(body.config);
      setDraft(null);
      await loadConnections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't verify Pipedream setup.");
    } finally {
      setBusy(null);
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/pipedream/apps?q=${encodeURIComponent(q)}`);
      const body = (await response.json().catch(() => ({}))) as {
        apps?: App[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Couldn't search apps.");
      setApps(body.apps ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't search apps.");
    } finally {
      setSearching(false);
    }
  };

  const connect = async (app: string) => {
    if (busy) return;
    setBusy(`connect:${app}`);
    setError(null);
    try {
      const response = await fetch("/api/pipedream/connect-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appSlug: app }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? "Couldn't start authorization.");
      }
      window.location.assign(body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't start authorization.");
      setBusy(null);
    }
  };

  const disconnect = async (connection: Connection) => {
    if (
      busy ||
      !window.confirm(
        `Disconnect ${connection.accountName ?? connection.appName} from Chief and Pipedream?`,
      )
    ) {
      return;
    }
    setBusy(`disconnect:${connection.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/pipedream/connections/${connection.id}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Couldn't disconnect account.");
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      if (toolsFor === connection.serverName) {
        setToolsFor(null);
        setTools(null);
      }
      if (notificationsFor === connection.id) {
        setNotificationsFor(null);
        setNotificationData(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't disconnect account.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div
        className="rounded-card border p-4 text-[13px] text-ink-3"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        Loading Pipedream…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div
          className="rounded-control border px-3 py-2 text-[12.5px]"
          style={{
            borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {(!config?.configured || draft) && (
        <div
          className="flex flex-col gap-4 rounded-card border p-4"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="flex flex-col gap-1">
            <div className="text-[17px] font-semibold text-ink">
              {config?.configured ? "Update Pipedream setup" : "Connect your Pipedream account"}
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">
              One Pipedream project unlocks hosted sign-in for every app Chief can use.
            </p>
          </div>

          {!config?.configured && <PipedreamSetupWalkthrough />}

          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Project ID
            <input
              id="pipedream-project-id"
              value={draft?.projectId ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, projectId: event.target.value } : current,
                )
              }
              placeholder="proj_…"
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Client ID
            <input
              type="password"
              value={draft?.clientId ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, clientId: event.target.value } : current,
                )
              }
              placeholder={config?.configured ? "Enter to replace saved credentials" : "OAuth client ID"}
              autoComplete="new-password"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Client secret
            <input
              type="password"
              value={draft?.clientSecret ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, clientSecret: event.target.value } : current,
                )
              }
              placeholder={config?.configured ? "Enter to replace saved credentials" : "OAuth client secret"}
              autoComplete="new-password"
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
            Environment
            <select
              value={draft?.environment ?? "development"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        environment:
                          event.target.value === "production" ? "production" : "development",
                      }
                    : current,
                )
              }
              className={inputClass}
              style={{ borderColor: "var(--hairline)" }}
            >
              <option value="development">Development</option>
              <option value="production">Production</option>
            </select>
          </label>
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            Client credentials are encrypted in Supabase Vault. They are never returned
            to this browser or included in Chief&apos;s model context.
          </p>
          <div className="flex gap-2">
            {config?.configured && (
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-11 flex-1 rounded-control border text-[14px] text-ink-2"
                style={{ borderColor: "var(--hairline)" }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={busy === "setup"}
              className="h-11 flex-1 rounded-control text-[14px] font-semibold disabled:opacity-50"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy === "setup" ? "Verifying…" : "Verify & continue"}
            </button>
          </div>
        </div>
      )}

      {config?.configured && !draft && (
        <>
          <div
            className="flex items-center gap-3 rounded-card border p-4"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <StatusDot ok />
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] text-ink">Pipedream ready</div>
              <div className="truncate font-mono text-[10.5px] text-ink-3">
                {config.projectId} · {config.environment?.toUpperCase()} · CREDENTIALS SAVED
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...emptyDraft(),
                  projectId: config.projectId ?? "",
                  environment: config.environment ?? "development",
                })
              }
              className="font-mono text-[10.5px] tracking-[0.05em] text-teal"
            >
              EDIT
            </button>
          </div>

          <div
            className="flex flex-col gap-3 rounded-card border p-4"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div>
              <div className="text-[16px] font-semibold text-ink">Connect an app</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                Search Pipedream, then authorize the account in its hosted secure flow.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void search()}
                placeholder="Search Gmail, Notion, Slack…"
                className={inputClass}
                style={{ borderColor: "var(--hairline)" }}
              />
              <button
                type="button"
                onClick={() => void search()}
                disabled={!query.trim() || searching}
                className="h-[42px] rounded-control px-3.5 text-[13.5px] font-semibold disabled:opacity-40"
                style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
              >
                {searching ? "…" : "Search"}
              </button>
            </div>
            {apps.map((app) => (
              <div key={app.slug} className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-[13px] font-semibold text-ink-2"
                  style={{ background: "var(--raised)" }}
                >
                  {app.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-ink">{app.name}</div>
                  <div className="truncate text-[11.5px] text-ink-3">
                    {app.description ?? app.slug}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void connect(app.slug)}
                  disabled={Boolean(busy)}
                  className="shrink-0 rounded-control border px-3 py-2 text-[12.5px] font-semibold text-teal disabled:opacity-50"
                  style={{ borderColor: "var(--teal-border)" }}
                >
                  {busy === `connect:${app.slug}` ? "Opening…" : "Connect"}
                </button>
              </div>
            ))}
            {!searching && query.trim() && apps.length === 0 && (
              <div className="text-[12.5px] text-ink-3">
                Search to find apps with MCP tools.
              </div>
            )}
          </div>

          <div
            className="flex flex-col gap-3 rounded-card border p-4"
            style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
          >
            <div>
              <div className="text-[16px] font-semibold text-ink">Connected apps</div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                Verified reads run automatically. Writes, sends, deletes, and unknown
                tools always ask first.
              </p>
            </div>
            {connections.length === 0 && (
              <div className="text-[13px] text-ink-3">No Pipedream apps connected yet.</div>
            )}
            {connections.map((connection) => {
              const toolsExpanded = toolsFor === connection.serverName;
              const notificationsExpanded = notificationsFor === connection.id;
              return (
                <div key={connection.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <StatusDot ok={connection.healthy} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] text-ink">
                        {connection.appName}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-ink-3">
                        {connection.accountName ?? connection.accountId} ·{" "}
                        {connection.healthy ? "CONNECTED" : "NEEDS RECONNECT"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-x-4 gap-y-2">
                    <button
                      type="button"
                      onClick={() => void loadTools(connection.serverName)}
                      className="font-mono text-[10.5px] tracking-[0.05em] text-teal"
                    >
                      TOOLS {toolsExpanded ? "▴" : "▾"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadNotifications(connection.id)}
                      disabled={Boolean(notificationBusy)}
                      className="font-mono text-[10.5px] tracking-[0.05em] text-teal disabled:opacity-50"
                    >
                      NOTIFY {notificationsExpanded ? "▴" : "▾"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void connect(connection.appSlug)}
                      disabled={Boolean(busy)}
                      className="font-mono text-[10.5px] tracking-[0.05em] text-teal disabled:opacity-50"
                    >
                      RECONNECT
                    </button>
                    <button
                      type="button"
                      onClick={() => void disconnect(connection)}
                      disabled={Boolean(busy)}
                      className="font-mono text-[10.5px] tracking-[0.05em] text-ink-3 disabled:opacity-50"
                    >
                      {busy === `disconnect:${connection.id}` ? "REMOVING…" : "REMOVE"}
                    </button>
                  </div>

                  {notificationsExpanded && (
                    <div
                      className="flex flex-col gap-2 rounded-control border p-3"
                      style={{ borderColor: "var(--hairline)" }}
                    >
                      <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
                        NOTIFY ME WHEN…
                      </div>
                      <p className="text-[11.5px] leading-relaxed text-ink-3">
                        Choose which events should wake Chief. It will summarize what
                        happened and may suggest an action; nothing runs without approval.
                      </p>
                      {connection.appSlug === "frontapp" && (
                        <p className="text-[11.5px] leading-relaxed text-ink-3">
                          Front&apos;s current Pipedream event sources can miss or replay
                          activity, so Chief does not offer Front notifications yet.
                          Mention, inbound-message, and sender filters need a reliable
                          upstream event feed first.
                        </p>
                      )}
                      {notificationError && !notificationNeedsMigration && (
                        <div className="text-[12px]" style={{ color: "var(--danger)" }}>
                          {notificationError}
                        </div>
                      )}
                      {notificationNeedsMigration && (
                        <div className="flex flex-col gap-2">
                          <div className="text-[13.5px] font-semibold text-ink">
                            One quick database update
                          </div>
                          <p className="text-[12px] leading-relaxed text-ink-2">
                            Notifications need the migration included with this Chief
                            update. It runs only against your own Supabase database.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              void applyNotificationMigration(connection.id)
                            }
                            disabled={
                              notificationBusy === `migration:${connection.id}`
                            }
                            className="flex h-10 items-center justify-center rounded-control text-[13px] font-semibold disabled:opacity-50"
                            style={{
                              background: "var(--teal-fill)",
                              color: "var(--teal-on-fill)",
                            }}
                          >
                            {notificationBusy === `migration:${connection.id}`
                              ? "Applying…"
                              : "Apply database update"}
                          </button>
                          {notificationError && (
                            <div
                              className="text-[12px]"
                              style={{ color: "var(--danger)" }}
                            >
                              {notificationError}
                            </div>
                          )}
                        </div>
                      )}
                      {notificationData === null && !notificationError && (
                        <div className="text-[13px] text-ink-3">Loading notifications…</div>
                      )}
                      {notificationData?.components.length === 0 && (
                        <div className="text-[13px] text-ink-3">
                          {connection.appSlug === "frontapp"
                            ? "No reliable Front notification events are available yet."
                            : "No notification events Chief can configure for this app yet."}
                        </div>
                      )}
                      {notificationData?.components.map((component) => {
                        const enabled = notificationData.deployed.find(
                          (trigger) => trigger.componentId === component.id,
                        );
                        const enablingKey = `${connection.id}:${component.id}`;
                        const selectedConfig =
                          notificationConfig[enablingKey] ?? {};
                        const configComplete = component.configProps.every(
                          (prop) =>
                            !prop.required ||
                            (selectedConfig[prop.name]?.length ?? 0) > 0,
                        );
                        const canEnable =
                          component.supported !== false && configComplete;
                        const disablingKey = enabled
                          ? `${connection.id}:${enabled.id}`
                          : null;
                        return (
                          <div key={component.id} className="flex flex-col gap-2.5">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-[13.5px] text-ink">
                                  {component.name}
                                </div>
                                {component.description && (
                                  <div className="text-[11.5px] leading-relaxed text-ink-3">
                                    {component.description}
                                  </div>
                                )}
                                {enabled?.name?.startsWith(`${component.name}: `) && (
                                  <div className="text-[11.5px] text-teal">
                                    Listening for{" "}
                                    {enabled.name.slice(component.name.length + 2)}
                                  </div>
                                )}
                                {!component.supported &&
                                  component.unsupportedReason && (
                                    <div className="text-[11.5px] text-ink-3">
                                      {component.unsupportedReason}
                                    </div>
                                  )}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  enabled
                                    ? void disableNotification(connection.id, enabled)
                                    : void enableNotification(connection.id, component)
                                }
                                disabled={
                                  (!enabled && !canEnable) ||
                                  notificationBusy === enablingKey ||
                                  notificationBusy === disablingKey
                                }
                                className="shrink-0 rounded-chip border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] disabled:opacity-50"
                                style={
                                  enabled
                                    ? {
                                        background: "var(--teal-fill)",
                                        color: "var(--teal-on-fill)",
                                        borderColor: "transparent",
                                      }
                                    : canEnable
                                      ? {
                                          borderColor: "var(--teal-border)",
                                          color: "var(--teal)",
                                        }
                                      : {
                                          borderColor: "var(--hairline)",
                                          color: "var(--ink-3)",
                                        }
                                }
                              >
                                {enabled
                                  ? "ON"
                                  : !component.supported
                                    ? "UNAVAILABLE"
                                    : configComplete
                                      ? "TURN ON"
                                      : "CHOOSE"}
                              </button>
                            </div>
                            {!enabled &&
                              component.configProps.map((prop) => (
                                <div key={prop.name} className="flex flex-col gap-1.5">
                                  <div className="text-[11.5px] text-ink-2">
                                    {prop.label}
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {prop.options.map((option) => {
                                      const selected = (
                                        selectedConfig[prop.name] ?? []
                                      ).includes(option.value);
                                      return (
                                        <button
                                          key={option.value}
                                          type="button"
                                          onClick={() =>
                                            toggleNotificationOption(
                                              connection.id,
                                              component,
                                              prop,
                                              option.value,
                                            )
                                          }
                                          className="rounded-chip border px-2.5 py-1.5 text-[11.5px]"
                                          style={
                                            selected
                                              ? {
                                                  background: "var(--teal-fill)",
                                                  color: "var(--teal-on-fill)",
                                                  borderColor: "transparent",
                                                }
                                              : {
                                                  borderColor: "var(--hairline)",
                                                  color: "var(--ink-2)",
                                                }
                                          }
                                        >
                                          {option.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                          </div>
                        );
                      })}
                      {notificationData?.deployed
                        .filter(
                          (trigger) =>
                            !notificationData.components.some(
                              (component) => component.id === trigger.componentId,
                            ),
                        )
                        .map((trigger) => (
                          <div key={trigger.id} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] text-ink">
                                {trigger.name ?? "Existing notification"}
                              </div>
                              <div className="truncate text-[11.5px] text-ink-3">
                                No longer in Pipedream&apos;s catalog
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                void disableNotification(connection.id, trigger)
                              }
                              disabled={
                                notificationBusy === `${connection.id}:${trigger.id}`
                              }
                              className="shrink-0 rounded-chip border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] disabled:opacity-50"
                              style={{
                                background: "var(--teal-fill)",
                                color: "var(--teal-on-fill)",
                                borderColor: "transparent",
                              }}
                            >
                              ON
                            </button>
                          </div>
                        ))}
                    </div>
                  )}

                  {toolsExpanded && (
                    <>
                      {tools === null && !toolsError && (
                        <div className="text-[13px] text-ink-3">Listing tools…</div>
                      )}
                      {toolsError && (
                        <div className="text-[13px]" style={{ color: "var(--danger)" }}>
                          {toolsError}
                        </div>
                      )}
                      {tools && (
                        <ToolModes
                          server={connection.serverName}
                          tools={tools}
                          busy={toolBusy}
                          onChange={(server, tool, mode) =>
                            void setToolMode(server, tool, mode)
                          }
                        />
                      )}
                    </>
                  )}
                  <div className="h-px" style={{ background: "var(--hairline)" }} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
