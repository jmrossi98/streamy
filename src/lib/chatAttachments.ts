import { prisma } from "@/lib/db";
import { pdfToText } from "@/lib/resume";
import {
  attachmentIdsIn,
  cleanFileName,
  isAttachmentId,
  kindOfMime,
  sniffAttachment,
  type AttachmentRef,
  type LoadedAttachment,
} from "@/lib/chatAttachmentRules";

/**
 * Stored chat attachments. Every query is scoped to the admin's user id: an id
 * from another account is "not found", never someone else's file.
 */

/** An upload that no saved chat claimed within this long is deleted. */
const UNLINKED_TTL_MS = 24 * 60 * 60_000;

export type StoreResult = { ok: true; ref: AttachmentRef } | { ok: false; status: number; error: string };

/** Checks the bytes and stores them against the admin; the type is decided by sniffAttachment. */
export async function storeAttachment(userId: string, name: unknown, bytes: Uint8Array): Promise<StoreResult> {
  const cleanName = cleanFileName(name);
  const sniffed = sniffAttachment(bytes, cleanName);
  if (!sniffed.ok) return { ok: false, status: 415, error: sniffed.error };
  // Opportunistic: uploads are rare, so the sweep rides on them.
  await prisma.chatAttachment
    .deleteMany({ where: { sessionId: null, createdAt: { lt: new Date(Date.now() - UNLINKED_TTL_MS) } } })
    .catch(() => undefined);
  const row = await prisma.chatAttachment.create({
    data: { userId, name: cleanName, mime: sniffed.mime, size: bytes.length, data: Buffer.from(bytes) },
    select: { id: true },
  });
  return { ok: true, ref: { id: row.id, name: cleanName, mime: sniffed.mime, size: bytes.length } };
}

export async function readAttachment(userId: string, id: string) {
  if (!isAttachmentId(id)) return null;
  return prisma.chatAttachment.findFirst({ where: { id, userId }, select: { name: true, mime: true, data: true } });
}

/**
 * The stored files the refs name, with text extracted from text files and
 * PDFs. A ref that is not this admin's, or whose file is gone, is simply
 * missing from the map (the message then says it is no longer available).
 */
export async function loadAttachments(userId: string, refs: readonly AttachmentRef[]): Promise<Map<string, LoadedAttachment>> {
  const out = new Map<string, LoadedAttachment>();
  const ids = [...new Set(refs.map((r) => r.id))];
  if (ids.length === 0) return out;
  const rows = await prisma.chatAttachment.findMany({ where: { userId, id: { in: ids } } });
  for (const row of rows) {
    const kind = kindOfMime(row.mime);
    if (!kind) continue;
    const bytes = new Uint8Array(row.data);
    let text: string | undefined;
    if (kind === "text") text = new TextDecoder().decode(bytes);
    else if (kind === "pdf") {
      try {
        text = (await pdfToText(bytes)).trim() || "(No text could be read from this PDF - it may be scanned images.)";
      } catch (err) {
        console.error("[chat] pdf text extraction failed:", err);
        text = "(This PDF could not be read.)";
      }
    }
    out.set(row.id, { id: row.id, name: row.name, mime: row.mime, size: row.size, kind, bytes, text });
  }
  return out;
}

/**
 * After a chat is saved: the uploads its turns name are linked to it, and
 * files it no longer names (a message was deleted or edited away) are removed.
 */
export async function syncSessionAttachments(
  userId: string,
  sessionId: string,
  turns: readonly { attachments?: readonly AttachmentRef[] }[]
): Promise<void> {
  const ids = attachmentIdsIn(turns);
  try {
    if (ids.length > 0) {
      await prisma.chatAttachment.updateMany({ where: { id: { in: ids }, userId, sessionId: null }, data: { sessionId } });
    }
    await prisma.chatAttachment.deleteMany({ where: { sessionId, userId, id: { notIn: ids } } });
  } catch (err) {
    // The chat is saved either way; a file left unlinked is swept later.
    console.error("[chat] linking attachments failed:", err);
  }
}
