// Projects — the list. Each row: name, a status chip only when the project
// isn't active (active is the silent default), and the current-state headline
// (the living record's first line) in quiet ink.

import Link from "next/link";
import NewProject from "@/app/components/NewProject";
import StatusChip from "@/app/components/StatusChip";
import { listProjectsWithState } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjectsWithState();
  const visible = projects.filter((p) => p.status !== "archived");

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="text-micro text-ink-3">PROJECTS · {visible.length}</div>

      {visible.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface p-5">
          <p className="chief-voice text-base text-ink-2">
            No projects yet. Create one below — Chief keeps its living record.
          </p>
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-card border border-hairline bg-surface">
          {visible.map((p, i) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className={`flex items-center gap-3 px-4 py-3.5 ${
                i < visible.length - 1 ? "border-b border-hairline" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-semibold text-ink">
                    {p.name}
                  </span>
                  {p.status !== "active" && <StatusChip status={p.status} />}
                </div>
                {p.state?.current_state && (
                  <div className="mt-1 truncate text-[14px] text-ink-2">
                    {p.state.current_state}
                  </div>
                )}
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12" className="shrink-0" aria-hidden="true">
                <path
                  d="M1 1l5 5-5 5"
                  stroke="var(--ink-3)"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          ))}
        </div>
      )}

      <NewProject />
    </div>
  );
}
