// Chat attachments for Chief — lets the user upload a document (PDF, image, or
// text file) into the conversation. Ported from Email-wrapper's chat-attachments
// with no changes to the wire format: images/PDFs ride along as base64 content
// blocks (Claude parses PDFs natively — no server-side extraction needed);
// text files are inlined as text ahead of the typed message.

import type Anthropic from "@anthropic-ai/sdk";

export type ChatAttachment =
  | { kind: "image"; name: string; mediaType: string; data: string }
  | { kind: "document"; name: string; mediaType: string; data: string }
  | { kind: "text"; name: string; text: string };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// ~7MB of base64 per file, 10 files max — enough for a scanned doc or a few
// screenshots without letting a request balloon unbounded.
const MAX_ATT_CHARS = 7_000_000;
const MAX_ATTACHMENTS = 10;

/**
 * Fold validated attachments into the latest user turn as content blocks
 * (images/PDFs as base64; text files inlined ahead of the typed message).
 * Mutates `convo` in place; a no-op when there's nothing valid to attach.
 */
export function applyAttachments(
  convo: Anthropic.MessageParam[],
  attachments: ChatAttachment[],
): void {
  const clean = attachments
    .filter((a) => {
      if (a.kind === "image")
        return IMAGE_TYPES.includes(a.mediaType) && a.data.length < MAX_ATT_CHARS;
      if (a.kind === "document")
        return a.mediaType === "application/pdf" && a.data.length < MAX_ATT_CHARS;
      return a.kind === "text" && typeof a.text === "string" && a.text.length < MAX_ATT_CHARS;
    })
    .slice(0, MAX_ATTACHMENTS);
  if (clean.length === 0) return;

  for (let i = convo.length - 1; i >= 0; i--) {
    if (convo[i].role !== "user") continue;
    const original = typeof convo[i].content === "string" ? (convo[i].content as string) : "";
    const blocks: Anthropic.ContentBlockParam[] = [];
    const textFiles: string[] = [];
    for (const a of clean) {
      if (a.kind === "image") {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: a.mediaType as "image/png", data: a.data },
        });
      } else if (a.kind === "document") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: a.data },
        });
      } else {
        textFiles.push(`--- Attached file: ${a.name} ---\n${a.text}`);
      }
    }
    const text = [...textFiles, original].filter(Boolean).join("\n\n") || "(see attachment)";
    blocks.push({ type: "text", text });
    convo[i] = { role: "user", content: blocks };
    break;
  }
}
