// Small shared pieces of the task-row vocabulary (design spec 1b/1c):
// the 20px checkbox (teal-filled when done).

export function TaskCheckbox({
  done,
  onToggle,
  disabled,
}: {
  done: boolean;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={done ? "Mark not done" : "Mark done"}
      onClick={onToggle}
      disabled={disabled}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-chip"
      style={
        done
          ? { background: "var(--teal-fill)" }
          : { border: "1.5px solid var(--ink-3)" }
      }
    >
      {done && (
        <svg width="10" height="8" viewBox="0 0 11 9" fill="none" aria-hidden="true">
          <path
            d="M1 4.5L4 7.5 10 1"
            stroke="var(--teal-on-fill)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
