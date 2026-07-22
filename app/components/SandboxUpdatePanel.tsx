"use client";

// The "Update this app" surface: a focused, page-aware version of Chief that
// drives the sandbox coding agent (SANDBOX-PLAN.md). Opened by the chat chip
// (startAppUpdate) and rendered inside ChiefSheet's chrome. Kept separate from
// the regular conversation so the everyday chat never carries sandbox-run logic.
//
// It reuses the background-run endpoints: POST /api/dev/sandbox-agent starts a
// job; GET polls it for the PR link. The current page context is folded into the
// task so Claude Code knows which screen the request is about.

import { useState } from "react";
import { useChief } from "./ChiefProvider";

export default function SandboxUpdatePanel() {
  const { page } = useChief();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const pageLabel = page?.label ?? "this app";

  const run = async () => {
    const change = text.trim();
    if (!change) {
      setResult("Describe the change you want, then tap Run.");
      return;
    }
    setResult(null);
    setBusy(true);
    // Fold in the page context Chief would otherwise have — so the agent knows
    // which screen this is about.
    const task = page?.route
      ? `${change}\n\n(Requested from the "${page.label}" screen, route ${page.route}.)`
      : change;
    try {
      const res = await fetch("/api/dev/sandbox-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (data.error) {
        setResult(`❌ ${data.error}`);
        setBusy(false);
        return;
      }
      if (!data.jobId) {
        setResult("⚠️ Couldn't start the update.");
        setBusy(false);
        return;
      }
      void poll(data.jobId, 0);
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : "Request failed."}`);
      setBusy(false);
    }
  };

  const poll = async (jobId: string, tries: number) => {
    try {
      const res = await fetch(
        `/api/dev/sandbox-agent?jobId=${encodeURIComponent(jobId)}`,
      );
      const { job } = (await res.json()) as {
        job?: { status: string; prUrl?: string | null; error?: string | null };
      };
      if (job?.status === "done") {
        setResult(job.prUrl ? `✅ Done — pull request: ${job.prUrl}` : "✅ Done.");
        setBusy(false);
        return;
      }
      if (job?.status === "error") {
        setResult(`❌ ${job.error ?? "The update failed."}`);
        setBusy(false);
        return;
      }
    } catch {
      /* transient — keep polling */
    }
    if (tries > 200) {
      setResult(
        "⏳ Still running — you can close this; the PR will appear on GitHub when it's done.",
      );
      setBusy(false);
      return;
    }
    setTimeout(() => void poll(jobId, tries + 1), 4000);
  };

  const url = result?.match(/https?:\/\/\S+/)?.[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-3">
      <div className="flex items-start gap-3">
        <div
          className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border font-serif text-[15px] italic text-teal"
          style={{ background: "var(--teal-dim)", borderColor: "var(--teal-border)" }}
          aria-hidden="true"
        >
          C
        </div>
        <div className="flex flex-col gap-2">
          <p className="chief-voice text-narrative text-ink">
            What should I change about {pageLabel}?
          </p>
          <p className="text-[12px] leading-snug text-ink-3">
            I&apos;ll make the change in an isolated sandbox and open a pull
            request for you to review and merge — nothing deploys until you do.
          </p>
        </div>
      </div>

      <textarea
        value={text}
        placeholder={`e.g. “add a project picker to ${pageLabel}”`}
        rows={3}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="mt-3 w-full rounded-control border bg-transparent px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-ink-2 disabled:opacity-60"
        style={{ borderColor: "var(--hairline)" }}
      />

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="mt-2 flex h-12 items-center justify-center rounded-control text-[15px] font-semibold disabled:opacity-50"
        style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
      >
        {busy ? "Working…" : "Run update"}
      </button>

      {busy && (
        <div className="mt-2 text-[12px] leading-snug text-ink-3">
          Working in the sandbox — this can take a few minutes. You can close
          this; the PR will appear on GitHub when it&apos;s done.
        </div>
      )}

      {result && (
        <div className="mt-2 text-[13px] leading-snug text-ink">
          {url ? (
            <>
              {result.split(url)[0]}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-teal underline"
              >
                {url}
              </a>
            </>
          ) : (
            result
          )}
        </div>
      )}

      <div className="mt-3 text-[11px] leading-snug text-ink-3">
        Setup (turn on the sandbox, GitHub token, faster runs) lives in Config →
        Developer.
      </div>
    </div>
  );
}
