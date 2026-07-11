"use client";

// Floating menu button + slide-in drawer (ChatGPT-style). No top bar — the
// button floats over full-bleed page content, glassy and fixed in place while
// the page scrolls beneath it. The drawer holds the app's navigation (formerly
// the bottom tab bar), the profile row (→ full-screen Settings), and Sign out
// as the last item. Bigger, readable type throughout — menu rows are 16–17px
// with generous touch targets.

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
function ContactsIcon({ stroke }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" stroke={stroke} strokeWidth="1.7" />
      <path d="M3.5 19c.4-3.2 2.5-5 5.5-5s5.1 1.8 5.5 5M15 7h5M16.5 11h3.5M17 15h3" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/inbox", label: "Inbox", Icon: InboxIcon },
  { href: "/projects", label: "Projects", Icon: ProjectsIcon },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon },
  { href: "/notes", label: "Notes", Icon: NotesIcon },
  { href: "/contacts", label: "Contacts", Icon: ContactsIcon },
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
      {/* Invisible spacer — reserves room below the floating button without
          drawing a bar (no background, no border). */}
      <div
        aria-hidden="true"
        style={{ height: "calc(env(safe-area-inset-top) + 56px)" }}
      />

      <button
        onClick={() => setOpen(true)}
        aria-label="Menu"
        aria-expanded={open}
        className="fixed left-3 z-30 flex h-11 w-11 items-center justify-center rounded-full text-ink backdrop-blur-md"
        style={{
          top: "calc(env(safe-area-inset-top) + 10px)",
          background: "var(--float-surface)",
          boxShadow: "var(--float-shadow)",
        }}
      >
        <svg width="19" height="19" viewBox="0 0 19 19" fill="none" aria-hidden="true">
          <path d="M3 6.5h13M3 9.5h9M3 12.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

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
