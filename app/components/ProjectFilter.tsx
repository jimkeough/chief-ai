"use client";

// Compact "filter tasks by project" dropdown for the /tasks page. Drives the
// filter through the URL (`?project=<id>`) so the server component re-fetches
// and the filtered view is shareable/refresh-safe. "All projects" clears it.

import { useRouter, usePathname } from "next/navigation";

export default function ProjectFilter({
  projects,
  selected,
}: {
  projects: { id: string; name: string }[];
  selected: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    router.push(value ? `${pathname}?project=${encodeURIComponent(value)}` : pathname);
  }

  if (projects.length === 0) return null;

  return (
    <select
      value={selected ?? ""}
      onChange={onChange}
      aria-label="Filter tasks by project"
      className="max-w-[200px] truncate rounded-control border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink-2 outline-none"
    >
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
