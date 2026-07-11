"use client";

import { useCallback, useState } from "react";
import type { Contact } from "@/lib/contacts";

type Draft = {
  id: string | null;
  name: string;
  emails: string;
  company: string;
  context: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function toDraft(contact: Contact): Draft {
  return {
    id: contact.id,
    name: contact.name,
    emails: contact.emails.join(", "),
    company: contact.company ?? "",
    context: contact.notes ?? "",
  };
}

function parseEmails(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function sortContacts(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export default function ContactsClient({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!draft || busy) return false;
    if (!draft.name.trim()) {
      if (!draft.id && !draft.emails.trim() && !draft.company.trim() && !draft.context.trim()) {
        setDraft(null);
        return true;
      }
      setError("Add a name before saving.");
      return false;
    }
    const emails = parseEmails(draft.emails);
    if (emails.some((email) => !/^[^@\s]+@[^@\s]+$/.test(email))) {
      setError("Check the email addresses, then try again.");
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        draft.id ? `/api/contacts/${draft.id}` : "/api/contacts",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            name: draft.name,
            emails,
            company: draft.company,
            notes: draft.context,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        contact?: Contact;
        error?: string;
      };
      if (!response.ok || !body.contact) {
        setError(body.error ?? "Couldn't save this contact.");
        return false;
      }
      const saved = body.contact;

      setContacts((current) =>
        sortContacts(
          draft.id
            ? current.map((contact) =>
                contact.id === saved.id ? saved : contact,
              )
            : [...current, saved],
        ),
      );
      setDraft(null);
      return true;
    } catch {
      setError("Couldn't save this contact.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, draft]);

  const remove = useCallback(async () => {
    if (!draft?.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/contacts/${draft.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Couldn't delete this contact.");
        return;
      }
      setContacts((current) =>
        current.filter((contact) => contact.id !== draft.id),
      );
      setDraft(null);
      setConfirmDelete(false);
    } catch {
      setError("Couldn't delete this contact.");
    } finally {
      setBusy(false);
    }
  }, [busy, draft]);

  if (draft) {
    return (
      <form
        className="flex flex-col gap-5 pb-8 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="flex items-center gap-1 text-[14px] text-ink-2 disabled:opacity-50"
            aria-label="Back to contacts"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Contacts
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex h-9 items-center rounded-control px-4 text-[14px] font-semibold disabled:opacity-50"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            {busy ? "Saving…" : "Done"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold text-ink-2"
            style={{ background: "var(--raised)" }}
          >
            {draft.name.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <input
            autoFocus={!draft.id}
            value={draft.name}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
              setError(null);
            }}
            placeholder="Name"
            aria-label="Name"
            className="min-w-0 flex-1 bg-transparent text-[22px] font-semibold text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        <div className="flex flex-col gap-4 rounded-card border p-4" style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}>
          <label className="flex flex-col gap-1.5">
            <span className="text-micro text-ink-3">EMAIL ADDRESSES</span>
            <input
              type="email"
              multiple
              value={draft.emails}
              onChange={(event) => setDraft({ ...draft, emails: event.target.value })}
              placeholder="joe@company.com, joe@gmail.com"
              aria-describedby="contact-emails-help"
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            />
            <span id="contact-emails-help" className="text-[12px] text-ink-3">
              Separate multiple addresses with commas.
            </span>
          </label>
          <div style={{ borderTop: "1px solid var(--hairline)" }} />
          <label className="flex flex-col gap-1.5">
            <span className="text-micro text-ink-3">COMPANY OR TEAM</span>
            <input
              value={draft.company}
              onChange={(event) => setDraft({ ...draft, company: event.target.value })}
              placeholder="Acme"
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-micro text-ink-3">CONTEXT FOR CHIEF</span>
          <textarea
            value={draft.context}
            onChange={(event) => setDraft({ ...draft, context: event.target.value })}
            placeholder="CEO and final decision-maker. Prefers brief updates and responds fastest in the morning."
            rows={7}
            className="w-full resize-none rounded-card border bg-surface p-4 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
            style={{ borderColor: "var(--hairline)" }}
          />
          <span className="text-[12.5px] leading-relaxed text-ink-3">
            Add their role, priorities, communication style, or anything else Chief should keep in mind.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {draft.id && (
          <div className="mt-2 border-t pt-5" style={{ borderColor: "var(--hairline)" }}>
            {confirmDelete ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13.5px] text-ink-2">Delete this contact?</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                    className="h-9 rounded-control px-3 text-[13.5px] text-ink-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove()}
                    disabled={busy}
                    className="h-9 rounded-control px-3 text-[13.5px] font-semibold disabled:opacity-50"
                    style={{ color: "var(--danger)" }}
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-[13.5px]"
                style={{ color: "var(--danger)" }}
              >
                Delete contact
              </button>
            )}
          </div>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8 pt-2">
      <div className="text-micro text-ink-3">CONTACTS · {contacts.length}</div>

      <button
        onClick={() => {
          setDraft({
            id: null,
            name: "",
            emails: "",
            company: "",
            context: "",
          });
          setError(null);
          setConfirmDelete(false);
        }}
        className="flex h-11 items-center gap-2 rounded-card border px-4 text-[14.5px] text-ink-3"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <span className="text-[18px] leading-none text-ink-2">+</span>
        New contact
      </button>

      {contacts.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-1.5 rounded-card border px-6 py-16 text-center"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="chief-voice text-[19px] text-ink">Who matters to your work?</div>
          <div className="text-[13.5px] leading-relaxed text-ink-3">
            Add a few key people so Chief can give advice with the right context.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => {
                setDraft(toDraft(contact));
                setError(null);
                setConfirmDelete(false);
              }}
              className="flex items-start gap-3 rounded-card border p-4 text-left"
              style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-ink-2"
                style={{ background: "var(--raised)" }}
              >
                {contact.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[15.5px] font-semibold text-ink">
                  {contact.name}
                </span>
                {(contact.company || contact.emails[0]) && (
                  <span className="truncate text-[13px] text-ink-3">
                    {[contact.company, contact.emails[0]].filter(Boolean).join(" · ")}
                  </span>
                )}
                {contact.notes?.trim() && (
                  <span className="line-clamp-2 text-[13.5px] leading-snug text-ink-2">
                    {contact.notes}
                  </span>
                )}
              </span>
              <svg className="mt-2 shrink-0 text-ink-3" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 5.5l6.5 6.5L9 18.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
