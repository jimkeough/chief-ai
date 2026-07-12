"use client";

// The expanded Chief conversation — a full-screen overlay opened from the
// floating Chief launcher on any screen. Header: monogram, "LOOKING AT" label
// + the page context it was opened over, new chat, and minimize. Body is the shared
// conversation surface.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useChief } from "./ChiefProvider";
import ChiefConversation from "./ChiefConversation";

export default function ChiefSheet() {
  const { open, setOpen, page, newChat, streaming } = useChief();
  const pathname = usePathname();

  // Lock the page scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const label =
    page?.label ??
    (pathname === "/"
      ? "Home"
      : (pathname ?? "/").split("/")[1]?.replace(/^\w/, (c) => c.toUpperCase()) ||
        "Home");

  return (
    <div
      className="fixed inset-0 z-50 mx-auto flex max-w-[480px] flex-col"
      style={{
        background: "var(--surface)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Chief"
    >
      {/* Header: monogram · LOOKING AT + context · new chat · minimize */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border font-serif text-[19px] font-medium text-teal"
          style={{
            background: "var(--teal-dim)",
            borderColor: "var(--teal-border)",
          }}
          aria-hidden="true"
        >
          C
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3">
            LOOKING AT
          </div>
          <div className="truncate text-[15px] font-semibold text-ink">
            {label}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void newChat()}
          disabled={streaming}
          className="shrink-0 rounded-control bg-teal-fill px-3 py-2 font-mono text-[11px] font-medium tracking-[0.08em] text-teal-on-fill transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Start a new chat"
        >
          + NEW CHAT
        </button>
        <button
          type="button"
          aria-label="Minimize chat"
          onClick={() => setOpen(false)}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border"
          style={{ borderColor: "var(--hairline)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M1.5 9.5h9"
              stroke="var(--ink-2)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="h-px" style={{ background: "var(--hairline)" }} />

      <ChiefConversation />
    </div>
  );
}
