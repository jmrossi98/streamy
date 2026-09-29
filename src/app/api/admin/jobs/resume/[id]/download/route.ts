import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resumeFileName } from "@/lib/resumeRules";

export const runtime = "nodejs";

/** One resume version as a Markdown file. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return new Response("Unauthorized", { status: 403 });
  const { id } = await params;
  const row = await prisma.resumeVersion.findUnique({ where: { id } });
  if (!row) return new Response("Not found", { status: 404 });
  const name = resumeFileName(row.company, row.title);
  return new Response(row.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
