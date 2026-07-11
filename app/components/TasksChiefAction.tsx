"use client";

import { useChief } from "./ChiefProvider";

export default function TasksChiefAction() {
  const { runIntent } = useChief();
  return (
    <button
      type="button"
      onClick={() => void runIntent({ id: "tasks.triage_open" })}
      className="flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13px] font-semibold text-ink"
      style={{ borderColor: "var(--teal-border)", background: "var(--surface)" }}
    >
      <span className="font-serif text-[15px] italic text-teal">C</span>
      Triage with Chief
    </button>
  );
}
