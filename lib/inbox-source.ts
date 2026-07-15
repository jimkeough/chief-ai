// Provider-agnostic inbox source shapes.
//
// Front (tag-required) is the first concrete source. Gmail / Outlook should
// implement the same list/detail contract later — do not fold them into
// MailProvider (archive/send). Inbox = triage list; MailProvider = email
// transport actions.

export type InboxProviderId = "front-tag" | "email" | "outlook";

/** One row in the inbox list — keep Chief-safe (no full bodies). */
export type InboxThreadSummary = {
  id: string;
  provider: InboxProviderId;
  subject: string;
  status: string;
  preview: string;
  correspondent: string;
  updatedAt: string | null;
  tags: string[];
  /** Deep link in the upstream app, if any. */
  externalUrl: string | null;
};

export type InboxThreadDetail = InboxThreadSummary & {
  /** Short body/preview for reading; full message fetch can expand later. */
  body: string;
  assignee: string;
  inboxes: string[];
};

export type FrontTagInboxList = {
  provider: "front-tag";
  connected: true;
  /** Tag required — Front inbox has no other stable filter. */
  tagId: string;
  tagName: string;
  account: string;
  source: string;
  total?: number;
  threads: InboxThreadSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  note?: string;
};

export type FrontTagInboxNeedsSetup = {
  provider: "front-tag";
  connected: true;
  needsTag: true;
  message: string;
};

export type FrontTagInboxDisconnected = {
  provider: "front-tag";
  connected: false;
};

export type FrontTagInboxError = {
  provider: "front-tag";
  connected: true;
  error: string;
};

export type FrontTagInboxResponse =
  | FrontTagInboxList
  | FrontTagInboxNeedsSetup
  | FrontTagInboxDisconnected
  | FrontTagInboxError;
