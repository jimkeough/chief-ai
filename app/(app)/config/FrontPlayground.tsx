"use client";

import { useState } from "react";

type Sample = { id: string; subject: string; status: string };
type Result = {
  ok: boolean;
  credential?: string;
  status?: number;
  pages?: number;
  pageCounts?: number[];
  totalUnique?: number;
  totalReported?: number;
  sample?: Sample[];
  firstPageRaw?: string;
  error?: string;
};

const inputClass =
  "w-full rounded-control border bg-transparent px-3 py-2.5 text-[13px] font-mono text-ink outline-none placeholder:text-ink-3";

const PRESETS = [
  "/tags/tag_6a990e/conversations",
  "/tags/tag_6a990e/conversations?limit=100",
  "/conversations/search/tag:tag_6a990e",
];

export default function FrontPlayground() {
  const [path, setPath] = useState(PRESETS[0]);
  const [credential, setCredential] = useState<"api" | "oauth" | "mcp">("api");
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/front/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, credential, follow }),
      });
      setResult((await response.json()) as Result);
    } catch (cause) {
      setResult({ ok: false, error: cause instanceof Error ? cause.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-card border p-4"
      style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
    >
      <div>
        <div className="text-[14.5px] font-semibold text-ink">Front API playground</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          Run a read-only Front Core API <span className="font-mono">GET</span> with either
          stored credential and see the counts. Use it to find which endpoint / credential
          returns the full tag inventory. Requests follow pagination automatically.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
        Path (api2.frontapp.com)
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          className={inputClass}
          style={{ borderColor: "var(--hairline)" }}
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setPath(preset)}
            className="rounded-chip border px-2.5 py-1.5 text-[11px] font-mono text-ink-2"
            style={{ borderColor: "var(--hairline)" }}
          >
            {preset.replace("tag_6a990e", "tag_…")}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex gap-1 rounded-control border p-1"
          style={{ borderColor: "var(--hairline)" }}
        >
          {(["api", "oauth", "mcp"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCredential(c)}
              className="rounded-chip px-3 py-1.5 text-[12px] font-semibold"
              style={{
                background: credential === c ? "var(--teal)" : "transparent",
                color: credential === c ? "white" : "var(--ink-2)",
              }}
            >
              {c === "api" ? "API token" : c === "oauth" ? "OAuth REST" : "MCP (as you)"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          Follow pagination
        </label>
        <button
          type="button"
          disabled={busy || !path.trim()}
          onClick={() => void run()}
          className="ml-auto h-10 rounded-control px-5 text-[13.5px] font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--teal)" }}
        >
          {busy ? "Running…" : "Run"}
        </button>
      </div>

      {result && (
        <div
          className="flex flex-col gap-2 rounded-control border p-3 text-[12.5px]"
          style={{ borderColor: "var(--hairline)" }}
        >
          {result.ok ? (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink">
                <span>
                  HTTP <strong>{result.status}</strong>
                </span>
                <span>
                  credential <strong>{result.credential}</strong>
                </span>
                <span>
                  unique <strong className="text-teal">{result.totalUnique}</strong>
                </span>
                {typeof result.totalReported === "number" && (
                  <span>
                    _total <strong>{result.totalReported}</strong>
                  </span>
                )}
                <span>
                  pages <strong>{result.pages}</strong> [{(result.pageCounts ?? []).join(", ")}]
                </span>
              </div>
              {result.sample && result.sample.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {result.sample.map((s) => (
                    <div key={s.id} className="truncate text-[11.5px] text-ink-3">
                      <span className="font-mono">{s.status}</span> · {s.subject}
                    </div>
                  ))}
                </div>
              )}
              {result.firstPageRaw && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11.5px] text-ink-3">
                    First-page raw JSON
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded-chip bg-black/5 p-2 text-[10.5px] leading-snug text-ink-2">
                    {result.firstPageRaw}
                  </pre>
                </details>
              )}
            </>
          ) : (
            <div style={{ color: "var(--danger)" }}>
              {result.status ? `HTTP ${result.status} — ` : ""}
              {result.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
