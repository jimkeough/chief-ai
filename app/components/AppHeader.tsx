"use client";

// Top bar + slide-in drawer (ChatGPT-style). The bar is just a hamburger; the
// drawer holds the app's navigation (formerly the bottom tab bar), the profile
// row (→ full-screen Settings), and Sign out as the last item. Bigger, readable
// type throughout — menu rows are 16–17px with generous touch targets.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type IconProps = { stroke: string };

function HomeIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 11.5L12 4.5l8 7V20h-5.5v-5h-5v5H4v-8.5z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function InboxIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5h16v13H4z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 13h4.5c.4 1.8 1.8 3 3.5 3s3.1-1.2 3.5-3H20" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function ChiefIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke={stroke} strokeWidth="1.7" />
      <path d="M14.8 9.6a3.4 3.4 0 100 4.8" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function ProjectsIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.5 7.5h5l2 2h10v9.5h-17V7.5z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function TasksIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke={stroke} strokeWidth="1.7" />
      <path d="M8 12.5l3 3 5.5-6" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function NotesIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3.5h8L18.5 8v12.5h-13V3.5z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8.5 11.5h7M8.5 15h5" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/inbox", label: "Inbox", Icon: InboxIcon },
  { href: "/chief", label: "Chief", Icon: ChiefIcon },
  { href: "/projects", label: "Projects", Icon: ProjectsIcon },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon },
  { href: "/notes", label: "Notes", Icon: NotesIcon },
] as const;

export default function AppHeader({
  initial,
  email,
}: {
  initial: string;
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <header
        className="sticky top-0 z-30 flex items-center px-3 py-2.5"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--hairline)" }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Menu"
          aria-expanded={open}
          className="flex h-10 w-10 items-center justify-center rounded-control text-ink"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-[84vw] max-w-[320px] flex-col"
            style={{ background: "var(--surface)", borderRight: "1px solid var(--hairline)" }}
          >
            <div className="flex items-center gap-2 px-4 pb-1 pt-3">
              <span className="font-serif text-[19px] font-medium text-ink">Chief</span>
            </div>

            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2">
              {NAV.map(({ href, label, Icon }) => {
                const on = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 rounded-control px-3 py-3"
                    style={on ? { background: "var(--teal-dim)" } : undefined}
                  >
                    <Icon stroke={on ? "var(--ink)" : "var(--ink-2)"} />
                    <span className={`text-[16.5px] ${on ? "font-semibold text-ink" : "text-ink"}`}>
                      {label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {/* Profile → full-screen Settings, then Sign out as the last item. */}
            <div
              className="flex flex-col gap-0.5 px-2 pb-[max(16px,env(safe-area-inset-bottom))] pt-2"
              style={{ borderTop: "1px solid var(--hairline)" }}
            >
              <Link
                href="/config"
                className="flex items-center gap-3 rounded-control px-3 py-3"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-ink-2"
                  style={{ background: "var(--raised)" }}
                >
                  {initial}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-medium text-ink">Settings</span>
                  {email && (
                    <span className="truncate text-[12.5px] text-ink-3">{email}</span>
                  )}
                </span>
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-control px-3 py-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9 4.5H5.5v15H9M14 8l4 4-4 4M18 12H9" stroke="var(--ink-3)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="text-[16px] text-ink-2">Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
