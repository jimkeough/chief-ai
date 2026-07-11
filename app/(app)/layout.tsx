import ChiefProvider from "@/app/components/ChiefProvider";
import ChiefLauncher from "@/app/components/ChiefLauncher";
import ChiefSheet from "@/app/components/ChiefSheet";
import AppHeader from "@/app/components/AppHeader";
import { getAuthed } from "@/lib/auth";

// App shell: persistent floating menu and Chief controls over scrollable page
// content. ChiefProvider holds the shared conversation and sheet state.
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
        <ChiefLauncher />
        <main className="flex-1 px-4 pb-10 pt-3">{children}</main>
      </div>
      <ChiefSheet />
    </ChiefProvider>
  );
}
