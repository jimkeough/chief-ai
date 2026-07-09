import ChiefProvider from "@/app/components/ChiefProvider";
import ChiefDock from "@/app/components/ChiefDock";
import ChiefSheet from "@/app/components/ChiefSheet";
import AppHeader from "@/app/components/AppHeader";
import { getAuthed } from "@/lib/auth";

// App shell: a minimal top bar (hamburger → nav drawer) over scrollable page
// content, with the Chief bar docked underneath on every screen. Navigation
// lives in the drawer (AppHeader); the bottom is reserved for the Chief bar —
// the product's core interaction — not tabs. ChiefProvider holds the one shared
// conversation (bar count, sheet, /chief page); the sheet overlays when open.
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const authed = await getAuthed();
  const email = authed
    ? (await authed.supabase.auth.getUser()).data.user?.email
    : null;
  const initial = (email?.[0] ?? "•").toUpperCase();

  return (
    <ChiefProvider>
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
        <AppHeader initial={initial} email={email ?? null} />
        <main className="flex-1 px-4 pb-32 pt-3">{children}</main>
        <div className="fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto max-w-[480px]">
            <ChiefDock />
          </div>
        </div>
      </div>
      <ChiefSheet />
    </ChiefProvider>
  );
}
