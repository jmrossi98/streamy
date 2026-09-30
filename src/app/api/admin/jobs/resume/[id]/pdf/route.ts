import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resumeToPdf } from "@/lib/resumePdf";
import { resumeFileName } from "@/lib/resumeRules";

export const runtime = "nodejs";

/** A tailored resume as the PDF that gets attached to applications. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const row = await prisma.resumeVersion.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdf = await resumeToPdf(row.markdown, `Resume - ${row.company}`);
  const name = resumeFileName(row.company, row.title).replace(/\.md$/, ".pdf");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
    },
  });
}
