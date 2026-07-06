import InboxClient from "./InboxClient";

// Inbox — one email at a time. All live state (connection, the email, Chief's
// read) is fetched client-side from /api/inbox so archive/undo can refresh in
// place; the server shell stays static.
export const dynamic = "force-dynamic";

export default function InboxPage() {
  return <InboxClient />;
}
