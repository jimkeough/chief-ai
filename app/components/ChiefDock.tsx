"use client";

// The live Chief bar: binds the static bar to the conversation state (pending
// proposal count) and opens the sheet on tap. Sits in the fixed dock above the
// bottom nav on every screen.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useChief } from "./ChiefProvider";
import ChiefBar from "./ChiefBar";

export default function ChiefDock() {
  const { pendingCount, setOpen } = useChief();
  const pathname = usePathname();
  // Proactive events waiting on Home ("since you were away") also count toward
  // the bar's pending badge, so the user sees there's something to review even
  // before they open Home. Polled lightly; refreshed on navigation.
  const [proactive, setProactive] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/events/list")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { events?: unknown[] } | null) => {
          if (alive && d?.events) setProactive(d.events.length);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  // The /chief page IS the conversation — no bar needed there.
  if (pathname?.startsWith("/chief")) return null;
  return (
    <ChiefBar
      pendingCount={pendingCount + proactive}
      pendingDetail="TAP TO REVIEW"
      onTap={() => setOpen(true)}
    />
  );
}
