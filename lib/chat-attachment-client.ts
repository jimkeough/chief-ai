"use client";

import type { ChatAttachment } from "@/lib/chat-attachments";
import { createClient } from "@/lib/supabase/client";

export const MAX_CHAT_FILES = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

async function toAttachment(
  file: File,
): Promise<{ attachment: ChatAttachment } | { error: string }> {
  if (file.size > MAX_FILE_BYTES) {
    return { error: `${file.name} is too large (max 5MB).` };
  }
  if (IMAGE_TYPES.includes(file.type)) {
    return {
      attachment: {
        kind: "image",
        name: file.name,
        mediaType: file.type,
        data: await readAsBase64(file),
      },
    };
  }
  if (file.type === "application/pdf") {
    return {
      attachment: {
        kind: "document",
        name: file.name,
        mediaType: file.type,
        data: await readAsBase64(file),
      },
    };
  }
  if (
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|csv)$/i.test(file.name)
  ) {
    return {
      attachment: { kind: "text", name: file.name, text: await file.text() },
    };
  }
  return { error: `${file.name}: unsupported file type.` };
}

export async function filesToChatAttachments(
  files: FileList | File[],
  available = MAX_CHAT_FILES,
): Promise<{ attachments: ChatAttachment[]; error: string | null }> {
  const all = Array.from(files);
  if (available <= 0) {
    return {
      attachments: [],
      error: `You can attach up to ${MAX_CHAT_FILES} files.`,
    };
  }
  const picked = all.slice(0, available);
  const results = await Promise.all(picked.map(toAttachment));
  const attachments: ChatAttachment[] = [];
  let error =
    all.length > available
      ? `You can attach up to ${MAX_CHAT_FILES} files.`
      : null;
  for (const result of results) {
    if ("attachment" in result) attachments.push(result.attachment);
    else error ??= result.error;
  }
  return { attachments, error };
}

function attachmentBlob(
  attachment: ChatAttachment,
): { blob: Blob; mediaType: string } {
  if (attachment.kind === "text") {
    const mediaType = "text/plain";
    return {
      blob: new Blob([attachment.text], { type: mediaType }),
      mediaType,
    };
  }
  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return {
    blob: new Blob([bytes], { type: attachment.mediaType }),
    mediaType: attachment.mediaType,
  };
}

export async function storeChiefAttachments(
  sessionId: string,
  attachments: ChatAttachment[],
): Promise<string[]> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error("Sign in again before uploading documents.");
  }

  const storedPaths: string[] = [];
  const insertedIds: string[] = [];
  try {
    for (const attachment of attachments) {
      const id = crypto.randomUUID();
      const path = `${user.id}/${sessionId}/${id}`;
      const { blob, mediaType } = attachmentBlob(attachment);
      const { error: uploadError } = await supabase.storage
        .from("chief-attachments")
        .upload(path, blob, { contentType: mediaType, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      storedPaths.push(path);

      const { error: insertError } = await supabase
        .from("chief_attachments")
        .insert({
          id,
          session_id: sessionId,
          name: attachment.name,
          kind: attachment.kind,
          media_type: mediaType,
          storage_path: path,
        });
      if (insertError) throw new Error(insertError.message);
      insertedIds.push(id);
    }
    return insertedIds;
  } catch (error) {
    if (storedPaths.length) {
      await supabase.storage.from("chief-attachments").remove(storedPaths);
    }
    if (insertedIds.length) {
      await supabase
        .from("chief_attachments")
        .delete()
        .in("id", insertedIds);
    }
    throw error;
  }
}
