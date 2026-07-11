"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useChief } from "./ChiefProvider";

// Chief's persistent entry point. It mirrors the menu button across the top of
// every signed-in screen and surfaces a notification dot when an actionable
// proposal or proactive event is waiting.
export default function ChiefLauncher() {
  const { pendingCount, setOpen } = useChief();
  const pathname = usePathname();
  const [proactiveCount, setProactiveCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/events/list")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { events?: unknown[] } | null) => {
          if (alive && data?.events) setProactiveCount(data.events.length);
        })
        .catch(() => {});

    load();
    const interval = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [pathname]);

  const notificationCount = pendingCount + proactiveCount;
  const hasNotifications = notificationCount > 0;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={
        hasNotifications
          ? `Open Chief — ${notificationCount} notification${notificationCount === 1 ? "" : "s"}`
          : "Open Chief"
      }
      className="fixed right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-teal-border bg-teal-dim font-serif text-[22px] font-medium text-teal backdrop-blur-md"
      style={{
        top: "calc(env(safe-area-inset-top) + 10px)",
        boxShadow: "var(--float-shadow)",
      }}
    >
      <span aria-hidden="true">C</span>
      {hasNotifications && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-notification"
          style={{ boxShadow: "0 0 0 2px var(--bg)" }}
        />
      )}
    </button>
  );
}
