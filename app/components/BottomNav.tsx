"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Bottom nav: Home · Inbox · C (center, raised teal circle) · Projects · Tasks · Notes.
// Labels mono 9px caps; active = ink, inactive = ink-3 (handoff/HANDOFF.md · Nav).

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

const TABS = [
  { href: "/", label: "HOME", Icon: HomeIcon },
  { href: "/inbox", label: "INBOX", Icon: InboxIcon },
  { href: "/projects", label: "PROJECTS", Icon: ProjectsIcon },
  { href: "/tasks", label: "TASKS", Icon: TasksIcon },
  { href: "/notes", label: "NOTES", Icon: NotesIcon },
] as const;

function Tab({
  href,
  label,
  Icon,
  active,
}: (typeof TABS)[number] & { active: boolean }) {
  return (
    <Link
      href={href}
      className="flex w-[52px] flex-col items-center gap-1 pt-1"
      aria-current={active ? "page" : undefined}
    >
      <Icon stroke={active ? "var(--ink)" : "var(--ink-3)"} />
      <span
        className={`font-mono text-[9px] tracking-[0.08em] ${active ? "text-ink" : "text-ink-3"}`}
      >
        {label}
      </span>
    </Link>
  );
}

export default function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      aria-label="Main"
      className="flex items-start justify-around px-1.5 pt-2.5"
      style={{ paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}
    >
      <Tab {...TABS[0]} active={isActive(TABS[0].href)} />
      <Tab {...TABS[1]} active={isActive(TABS[1].href)} />
      {/* Center slot: the C — 48px teal circle, raised −8px */}
      <Link href="/chief" className="-mt-2 flex w-[52px] flex-col items-center" aria-label="Chief">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full font-serif text-[22px] font-medium"
          style={{
            background: "var(--teal-fill)",
            border: "1px solid rgba(143,193,183,0.45)",
            color: "var(--teal-on-fill)",
            boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
          }}
        >
          C
        </span>
      </Link>
      <Tab {...TABS[2]} active={isActive(TABS[2].href)} />
      <Tab {...TABS[3]} active={isActive(TABS[3].href)} />
      <Tab {...TABS[4]} active={isActive(TABS[4].href)} />
    </nav>
  );
}
