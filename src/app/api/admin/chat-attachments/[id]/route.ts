import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { readAttachment } from "@/lib/chatAttachments";
import { attachmentHeaders } from "@/lib/chatAttachmentRules";

/**
 * An attachment's bytes, for the admin who uploaded it (thumbnails and links
 * in a reopened chat). The type served is the one sniffed at upload, with
 * nosniff and a sandboxing CSP, so nothing here can run as a page.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const row = await readAttachment(admin.id, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: attachmentHeaders(row.name, row.mime, row.data.length) });
}
