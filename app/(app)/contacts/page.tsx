import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import { listContacts } from "@/lib/contacts";
import ContactsClient from "./ContactsClient";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await listContacts();

  return (
    <>
      <ChiefPageSnapshot
        route="/contacts"
        label="Contacts"
        state={{
          contacts: contacts.slice(0, 80).map((contact) => ({
            id: contact.id,
            name: contact.name,
            emails: contact.emails,
            company: contact.company,
            context: contact.notes?.slice(0, 500) ?? null,
          })),
        }}
      />
      <ContactsClient initial={contacts} />
    </>
  );
}
