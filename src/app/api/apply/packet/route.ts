import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyTargetFromUrl } from "@/lib/applyFormRules";
import { isValidApplyToken, packetForTarget, parseAnswers } from "@/lib/applyPacket";
import { resumeToPdf } from "@/lib/resumePdf";

export const runtime = "nodejs";

/**
 * The packet for the application page the userscript is on. Token-authed,
 * not session-authed: the script runs on greenhouse.io / ashbyhq.com, where
 * Streamy's cookie is never sent.
 */
export async function GET(request: Request) {
  if (!(await isValidApplyToken(request.headers.get("x-apply-token")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pageUrl = new URL(request.url).searchParams.get("url") ?? "";
  const target = applyTargetFromUrl(pageUrl);
  if (!target) return NextResponse.json({ error: "Not an application page Streamy knows" }, { status: 404 });
  const row = await packetForTarget(target);
  if (!row) return NextResponse.json({ error: "No packet prepared for this job. Click Apply in Streamy first." }, { status: 404 });

  let resume: { fileName: string; base64: string } | null = null;
  if (row.resumeVersionId) {
    const version = await prisma.resumeVersion.findUnique({ where: { id: row.resumeVersionId } });
    if (version) {
      const pdf = await resumeToPdf(version.markdown, `Resume - ${row.company}`);
      const profileName = version.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().replace(/[^\w .-]+/g, "") || "Resume";
      resume = { fileName: `${profileName} - Resume.pdf`, base64: Buffer.from(pdf).toString("base64") };
    }
  }
  return NextResponse.json({
    id: row.id,
    company: row.company,
    title: row.title,
    status: row.status,
    answers: parseAnswers(row.answers),
    resume,
  });
}
