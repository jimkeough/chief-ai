import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ChatAttachment } from "@/lib/chat-attachments";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTACHMENTS = 10;

export async function loadChiefAttachments(
  ids: string[],
): Promise<ChatAttachment[]> {
  const clean = ids.filter((id) => UUID.test(id)).slice(0, MAX_ATTACHMENTS);
  if (clean.length !== ids.length || clean.length === 0) {
    throw new Error("Invalid document references.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chief_attachments")
    .select("id, name, kind, media_type, storage_path")
    .in("id", clean);
  if (error) throw new Error(error.message);
  const rows = new Map((data ?? []).map((row) => [row.id, row]));

  const attachments: ChatAttachment[] = [];
  for (const id of clean) {
    const row = rows.get(id);
    if (!row) throw new Error("A source document is no longer available.");
    const { data: file, error: downloadError } = await supabase.storage
      .from("chief-attachments")
      .download(row.storage_path);
    if (downloadError || !file) {
      throw new Error(
        downloadError?.message ?? "Could not read a source document.",
      );
    }
    if (row.kind === "text") {
      attachments.push({
        kind: "text",
        name: row.name,
        text: await file.text(),
      });
    } else {
      attachments.push({
        kind: row.kind,
        name: row.name,
        mediaType: row.media_type,
        data: Buffer.from(await file.arrayBuffer()).toString("base64"),
      } as ChatAttachment);
    }
  }
  return attachments;
}
