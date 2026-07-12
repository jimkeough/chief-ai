"use client";

// Proposal cards, built to the design spec (handoff/HANDOFF.md + Chief Design
// Spec). Semantic color rule is law: teal = Chief + reversible ("standard"),
// copper = irreversible, green = confirmation only.
//
// States per card: proposed → executing (spinner) → done (receipt row with
// persistent Undo) / error, or dismissed (dashed, with Restore). Irreversible
// (red-tier) proposals get the copper frame, an exact-payload block, and a
// slide-to-confirm track — never a one-tap approve, and never batched. When a
// single turn yields 2+ standard proposals they render as one batch card
// ("N PROPOSALS · ALL REVERSIBLE") with per-row ✓/✕ plus Approve all.

import { useCallback, useMemo, useRef, useState } from "react";
import type { ProposalItem, ProposalPlan } from "./ChiefProvider";

type Handlers = {
  onApprove: (uid: string, mergeTargetId?: string) => void | Promise<void>;
  onDismiss: (uid: string) => void;
  onRestore: (uid: string) => void;
  onUndo: (uid: string) => void;
};

// Mono card header, e.g. "CREATE TASK".
function monoLabel(key: string): string {
  return key.replace(/[-_]/g, " ").toUpperCase();
}

function Spinner({ color = "var(--teal)" }: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-transparent motion-reduce:animate-none"
      style={{ borderTopColor: color, borderRightColor: color }}
    />
  );
}

function CheckCircle() {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{ background: "color-mix(in srgb, var(--ok) 15%, transparent)" }}
      aria-hidden="true"
    >
      <svg width="13" height="11" viewBox="0 0 13 11" fill="none">
        <path
          d="M1.5 5.5l3.5 3.5L11.5 1.5"
          stroke="var(--ok)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// --- Receipt / dismissed rows (shared by both tiers and batch rows) ---------

function ReceiptRow({ item, onUndo }: { item: ProposalItem; onUndo: () => void }) {
  const undone = item.status === "undone";
  return (
    <div
      className="flex items-center gap-3 rounded-card border px-3.5 py-3"
      style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
    >
      {undone ? (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--teal-dim)" }}
          aria-hidden="true"
        >
          <svg width="13" height="12" viewBox="0 0 14 13" fill="none">
            <path
              d="M5 1L1.5 4.5 5 8M1.5 4.5H9a4 4 0 010 8H6"
              stroke="var(--teal)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : (
        <CheckCircle />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-snug text-ink">
          {item.result ?? (undone ? "Undone." : "Done.")}
        </div>
        {item.error && (
          <div className="mt-0.5 text-[12px]" style={{ color: "var(--danger)" }}>
            {item.error}
          </div>
        )}
      </div>
      {item.status === "done" && item.undo && (
        <button
          onClick={onUndo}
          className="shrink-0 px-2 py-2 font-mono text-[12px] tracking-[0.06em] text-teal"
        >
          Undo
        </button>
      )}
      {item.status === "undoing" && <Spinner />}
    </div>
  );
}

function DismissedRow({
  item,
  onRestore,
}: {
  item: ProposalItem;
  onRestore: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-card border border-dashed px-3.5 py-3"
      style={{ borderColor: "var(--hairline)" }}
    >
      <div className="min-w-0 flex-1 text-[13px] text-ink-3">
        Dismissed — Chief won&apos;t re-suggest this today.
      </div>
      <button
        onClick={onRestore}
        className="shrink-0 px-2 py-2 font-mono text-[12px] tracking-[0.06em] text-ink-2"
      >
        Restore
      </button>
    </div>
  );
}

function SupersededRow() {
  return (
    <div
      className="rounded-card border border-dashed px-3.5 py-3 text-[13px] text-ink-3"
      style={{ borderColor: "var(--hairline)" }}
    >
      Superseded by a newer plan.
    </div>
  );
}

// --- Standard (teal) card ----------------------------------------------------

const PREVIEW_CLAMP = 320;

function PreviewBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > PREVIEW_CLAMP;
  const shown = expanded || !long ? text : `${text.slice(0, PREVIEW_CLAMP)}…`;
  return (
    <div>
      <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        {shown}
      </div>
      {long && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 font-mono text-[11px] tracking-[0.08em] text-ink-3"
        >
          {expanded ? "SHOW LESS" : "SHOW MORE"}
        </button>
      )}
    </div>
  );
}

function StandardCard({ item, handlers }: { item: ProposalItem; handlers: Handlers }) {
  const p = item.proposal;
  if (item.status === "dismissed")
    return <DismissedRow item={item} onRestore={() => handlers.onRestore(item.uid)} />;
  if (item.status === "superseded") return <SupersededRow />;
  if (item.status === "done" || item.status === "undoing" || item.status === "undone")
    return <ReceiptRow item={item} onUndo={() => handlers.onUndo(item.uid)} />;

  const executing = item.status === "executing";
  return (
    <div
      className="rounded-card border p-3.5"
      style={{
        background: "var(--surface)",
        borderColor: "var(--teal-border)",
      }}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-[11px] tracking-[0.1em] text-teal">
          {monoLabel(p.key)}
        </span>
        <span className="font-mono text-[10px] tracking-[0.06em] text-ink-3">
          standard · reversible
        </span>
      </div>
      <div className="mb-1 text-[15px] font-semibold text-ink">{p.label}</div>
      <PreviewBlock text={p.preview} />

      {/* Merge choices for "Save to Memory": fold into an existing entry
          instead of creating a near-duplicate. */}
      {p.related && p.related.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
            OR MERGE INTO AN EXISTING ENTRY
          </div>
          {p.related.map((r) => (
            <button
              key={r.id}
              disabled={executing}
              onClick={() => handlers.onApprove(item.uid, r.id)}
              className="rounded-control border px-3 py-2 text-left text-[13px] text-ink-2"
              style={{ borderColor: "var(--hairline)" }}
            >
              <span className="text-ink">{r.title}</span>
              <span className="block truncate text-[12px] text-ink-3">
                {r.snippet}
              </span>
            </button>
          ))}
        </div>
      )}

      {item.status === "error" && (
        <div className="mt-2 text-[13px]" style={{ color: "var(--danger)" }}>
          {item.error}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={executing}
          onClick={() => handlers.onApprove(item.uid)}
          className="flex h-12 flex-[1.6] items-center justify-center gap-2 rounded-control text-[15px] font-semibold"
          style={{
            background: executing
              ? "color-mix(in srgb, var(--teal-fill) 40%, transparent)"
              : "var(--teal-fill)",
            color: "var(--teal-on-fill)",
          }}
        >
          {executing ? (
            <>
              <Spinner color="var(--teal-on-fill)" />
              Working…
            </>
          ) : item.status === "error" ? (
            "Retry"
          ) : (
            "Approve"
          )}
        </button>
        <button
          disabled={executing}
          onClick={() => handlers.onDismiss(item.uid)}
          className="h-12 flex-1 rounded-control border text-[15px] text-ink-2"
          style={{ borderColor: "var(--hairline)" }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// --- Irreversible (copper) card ----------------------------------------------

function SlideToConfirm({
  label,
  disabled,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const maxTravel = () => {
    const track = trackRef.current;
    return track ? track.clientWidth - 46 - 10 : 0;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDrag(Math.max(0, Math.min(maxTravel(), e.clientX - startX.current)));
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (drag >= maxTravel() - 4 && maxTravel() > 0) {
      setDrag(maxTravel());
      onConfirm();
    } else {
      setDrag(0);
    }
  };

  return (
    <div
      ref={trackRef}
      className="relative h-14 select-none overflow-hidden rounded-full border"
      style={{
        background: "color-mix(in srgb, var(--copper) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--copper) 35%, transparent)",
        touchAction: "none",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[12px] tracking-[0.12em]"
        style={{ color: "var(--copper)", opacity: 1 - drag / Math.max(maxTravel(), 1) }}
      >
        {label}
      </div>
      <div
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((drag / Math.max(maxTravel(), 1)) * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute left-[5px] top-[5px] flex h-[46px] w-[46px] items-center justify-center rounded-full motion-reduce:transition-none"
        style={{
          background: "var(--copper)",
          transform: `translateX(${drag}px)`,
          transition: dragging ? "none" : "transform 160ms ease",
          cursor: disabled ? "default" : "grab",
        }}
      >
        <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
          <path
            d="M1 7h13M9 1.5L14.5 7 9 12.5"
            stroke="#1c130b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function IrreversibleCard({
  item,
  handlers,
}: {
  item: ProposalItem;
  handlers: Handlers;
}) {
  const [payloadOpen, setPayloadOpen] = useState(false);
  const p = item.proposal;
  if (item.status === "dismissed")
    return <DismissedRow item={item} onRestore={() => handlers.onRestore(item.uid)} />;
  if (item.status === "done" || item.status === "undoing" || item.status === "undone")
    return <ReceiptRow item={item} onUndo={() => handlers.onUndo(item.uid)} />;

  const executing = item.status === "executing";
  return (
    <div
      className="rounded-card border p-3.5"
      style={{
        background: "color-mix(in srgb, var(--copper) 6%, var(--surface))",
        borderColor: "color-mix(in srgb, var(--copper) 42%, transparent)",
        boxShadow: "0 0 0 4px color-mix(in srgb, var(--copper) 6%, transparent)",
      }}
    >
      {/* Tier banner */}
      <div
        className="mb-3 flex items-center gap-2 rounded-control px-3 py-2"
        style={{ background: "color-mix(in srgb, var(--copper) 10%, transparent)" }}
      >
        <span aria-hidden="true" style={{ color: "var(--copper)", fontSize: 10 }}>
          ◆
        </span>
        <span
          className="font-mono text-[11px] tracking-[0.12em]"
          style={{ color: "var(--copper)" }}
        >
          {monoLabel(p.key)} · IRREVERSIBLE
        </span>
      </div>

      <div className="mb-2 text-[15px] font-semibold text-ink">{p.label}</div>

      {/* Exact payload — collapsed to a labeled block, tap to expand. */}
      <button
        onClick={() => setPayloadOpen((o) => !o)}
        className="w-full rounded-control px-3 py-2.5 text-left"
        style={{ background: "rgba(0,0,0,0.18)" }}
      >
        <div
          className="mb-1 font-mono text-[10px] tracking-[0.12em]"
          style={{ color: "var(--copper)" }}
        >
          EXACT PAYLOAD · {payloadOpen ? "TAP TO COLLAPSE" : "TAP TO EXPAND"}
        </div>
        <div
          className={`whitespace-pre-wrap text-[14px] leading-relaxed text-ink ${
            payloadOpen ? "" : "line-clamp-3"
          }`}
        >
          {p.preview}
        </div>
      </button>

      {item.status === "error" && (
        <div className="mt-2 text-[13px]" style={{ color: "var(--danger)" }}>
          {item.error}
        </div>
      )}

      <div className="mt-3">
        {executing ? (
          <div
            className="flex h-14 items-center justify-center gap-2 rounded-full font-mono text-[12px] tracking-[0.12em]"
            style={{
              background: "color-mix(in srgb, var(--copper) 10%, transparent)",
              color: "var(--copper)",
            }}
          >
            <Spinner color="var(--copper)" />
            WORKING…
          </div>
        ) : (
          <SlideToConfirm
            label="SLIDE TO CONFIRM"
            onConfirm={() => handlers.onApprove(item.uid)}
          />
        )}
      </div>
      <button
        disabled={executing}
        onClick={() => handlers.onDismiss(item.uid)}
        className="mt-1 h-11 w-full text-center text-[14px] text-ink-2"
      >
        Dismiss
      </button>
    </div>
  );
}

// --- Batch card (standard-tier only) -------------------------------------

function BatchRow({ item, handlers }: { item: ProposalItem; handlers: Handlers }) {
  const p = item.proposal;
  const firstLine = p.preview.split("\n")[0] ?? "";
  return (
    <div
      className="flex items-center gap-2.5 border-t py-2.5"
      style={{ borderColor: "var(--hairline)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{p.label}</div>
        <div className="truncate text-[12px] text-ink-3">
          {item.status === "done" || item.status === "undone"
            ? (item.result ?? firstLine)
            : item.status === "dismissed"
              ? "Dismissed"
              : item.status === "error"
                ? item.error
                : firstLine}
        </div>
      </div>
      {item.status === "proposed" || item.status === "error" ? (
        <>
          <button
            aria-label={`Approve: ${p.label}`}
            onClick={() => handlers.onApprove(item.uid)}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-control"
            style={{
              background: "color-mix(in srgb, var(--teal-fill) 35%, transparent)",
            }}
          >
            <svg width="14" height="12" viewBox="0 0 13 11" fill="none" aria-hidden="true">
              <path
                d="M1.5 5.5l3.5 3.5L11.5 1.5"
                stroke="var(--teal)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            aria-label={`Dismiss: ${p.label}`}
            onClick={() => handlers.onDismiss(item.uid)}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-control border"
            style={{ borderColor: "var(--hairline)" }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M1.5 1.5l9 9m0-9l-9 9"
                stroke="var(--ink-3)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      ) : item.status === "executing" || item.status === "undoing" ? (
        <Spinner />
      ) : item.status === "superseded" ? (
        <span className="shrink-0 font-mono text-[10px] tracking-[0.06em] text-ink-3">
          REVISED
        </span>
      ) : item.status === "dismissed" ? (
        <button
          onClick={() => handlers.onRestore(item.uid)}
          className="shrink-0 px-1 font-mono text-[11px] tracking-[0.06em] text-ink-2"
        >
          Restore
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          <CheckCircle />
          {item.status === "done" && item.undo && (
            <button
              onClick={() => handlers.onUndo(item.uid)}
              className="px-1 font-mono text-[11px] tracking-[0.06em] text-teal"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RevisionControl({
  disabled,
  onRevise,
}: {
  disabled: boolean;
  onRevise: (instruction: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const request = instruction.trim();
    if (!request || busy || disabled) return;
    setBusy(true);
    try {
      await onRevise(request);
      setInstruction("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="mt-2 h-10 w-full rounded-control border text-[13.5px] text-ink-2 disabled:opacity-40"
        style={{ borderColor: "var(--hairline)" }}
      >
        Suggest changes
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--hairline)" }}>
      <label className="font-mono text-[10px] tracking-[0.09em] text-ink-3">
        WHAT SHOULD CHIEF CHANGE?
      </label>
      <textarea
        autoFocus
        aria-label="Changes to the document plan"
        rows={3}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="For example: skip completed tasks and combine the two marketing projects."
        className="w-full resize-none rounded-control border bg-transparent px-3 py-2.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
        style={{ borderColor: "var(--hairline)" }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setInstruction("");
          }}
          disabled={busy}
          className="h-10 flex-1 rounded-control border text-[13px] text-ink-2"
          style={{ borderColor: "var(--hairline)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!instruction.trim() || busy || disabled}
          className="h-10 flex-[1.4] rounded-control text-[13px] font-semibold disabled:opacity-40"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          {busy ? "Revising…" : "Revise plan"}
        </button>
      </div>
    </div>
  );
}

// --- Group renderer -----------------------------------------------------

/** Render one assistant turn's proposals: 2+ standard proposals collapse into
 *  a batch card; irreversible ones always stand alone below it. */
export default function ProposalGroup({
  items,
  handlers,
  plan,
  onRevise,
  revisionDisabled = false,
}: {
  items: ProposalItem[];
  handlers: Handlers;
  plan?: ProposalPlan;
  onRevise?: (instruction: string) => Promise<void>;
  revisionDisabled?: boolean;
}) {
  const yellow = useMemo(
    () => items.filter((i) => i.proposal.tier === "yellow"),
    [items],
  );
  const red = useMemo(
    () => items.filter((i) => i.proposal.tier === "red"),
    [items],
  );
  const approvable = yellow.filter((i) => i.status === "proposed");
  const replaceable = yellow.filter(
    (i) => i.status === "proposed" || i.status === "error",
  );
  const supersededPlan =
    Boolean(plan) &&
    items.some((item) => item.status === "superseded") &&
    items.every(
      (item) =>
        item.status === "superseded" || item.status === "dismissed",
    );

  const approveAll = useCallback(async () => {
    // Import batches can create a project and then reference it by name from
    // later state/task cards, so preserve the model's proposal order.
    for (const i of approvable) await handlers.onApprove(i.uid);
  }, [approvable, handlers]);

  if (supersededPlan && plan) {
    return (
      <div
        className="rounded-card border border-dashed px-3.5 py-3"
        style={{ borderColor: "var(--hairline)" }}
      >
        <div className="font-mono text-[10px] tracking-[0.09em] text-ink-3">
          DOCUMENT PLAN · V{plan.version} · SUPERSEDED
        </div>
        <div className="mt-1 truncate text-[12.5px] text-ink-3">
          {plan.sourceNames.join(", ")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {yellow.length >= 2 ? (
        <div
          className="rounded-card border p-3.5"
          style={{ background: "var(--surface)", borderColor: "var(--teal-border)" }}
        >
          <div className="mb-1 flex items-center justify-between gap-2 pb-1">
            <span className="font-mono text-[11px] tracking-[0.1em] text-teal">
              {plan
                ? `DOCUMENT PLAN · V${plan.version} · ${yellow.length} CHANGES`
                : `${yellow.length} PROPOSALS · ALL REVERSIBLE`}
            </span>
            {approvable.length > 1 && (
              <button
                onClick={() => void approveAll()}
                className="h-[38px] shrink-0 rounded-control px-3.5 text-[13px] font-semibold"
                style={{
                  background: "var(--teal-fill)",
                  color: "var(--teal-on-fill)",
                }}
              >
                Approve all
              </button>
            )}
          </div>
          {plan && (
            <>
              <div className="mb-1 truncate text-[12px] text-ink-3">
                {plan.sourceNames.join(", ")} · all changes reversible
              </div>
              {plan.verification && (
                <div className="mb-1.5 font-mono text-[10px] tracking-[0.07em] text-teal">
                  EXTRACTED · {plan.verification.recordCount} SOURCE RECORDS ·{" "}
                  {plan.verification.proposalCount} CHANGES
                  {plan.verification.ambiguousCount
                    ? ` · ${plan.verification.ambiguousCount} NEED REVIEW`
                    : ""}
                </div>
              )}
            </>
          )}
          {yellow.map((i) => (
            <BatchRow key={i.uid} item={i} handlers={handlers} />
          ))}
          {plan && onRevise && replaceable.length > 0 && (
            <RevisionControl
              disabled={revisionDisabled}
              onRevise={onRevise}
            />
          )}
        </div>
      ) : (
        <>
          {plan && (
            <div
              className="rounded-control border px-3 py-2"
              style={{ borderColor: "var(--teal-border)" }}
            >
              <div className="font-mono text-[10px] tracking-[0.09em] text-teal">
                DOCUMENT PLAN · V{plan.version}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-ink-3">
                {plan.sourceNames.join(", ")}
              </div>
              {plan.verification && (
                <div className="mt-1 font-mono text-[10px] tracking-[0.07em] text-teal">
                  EXTRACTED · {plan.verification.recordCount} SOURCE RECORDS
                </div>
              )}
            </div>
          )}
          {yellow.map((i) => (
            <StandardCard key={i.uid} item={i} handlers={handlers} />
          ))}
          {plan && onRevise && replaceable.length > 0 && (
            <RevisionControl
              disabled={revisionDisabled}
              onRevise={onRevise}
            />
          )}
        </>
      )}
      {red.map((i) => (
        <IrreversibleCard key={i.uid} item={i} handlers={handlers} />
      ))}
    </div>
  );
}
