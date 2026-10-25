import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { storeAttachment } from "@/lib/chatAttachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/chatAttachmentRules";

/**
 * Upload of one file to attach to an assistant message. Admin only,
 * re-checked against the database. The type is decided from the file's bytes
 * (chatAttachmentRules.sniffAttachment), not from its name or the browser's
 * Content-Type; SVG, HTML and anything unrecognised are refused.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Multipart framing around a 5 MB file. */
const BODY_SLACK = 64 * 1024;

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Refuse an oversized body before reading it.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES + BODY_SLACK) {
    return NextResponse.json({ error: "That file is over 5 MB." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: "That file is over 5 MB." }, { status: 413 });

  const stored = await storeAttachment(admin.id, file.name, new Uint8Array(await file.arrayBuffer()));
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: stored.status });

  await logAudit(admin.name, "assistant.attachment", stored.ref.name, `${stored.ref.mime}, ${stored.ref.size} bytes, id ${stored.ref.id}`);
  return NextResponse.json({ attachment: stored.ref }, { status: 201 });
}
