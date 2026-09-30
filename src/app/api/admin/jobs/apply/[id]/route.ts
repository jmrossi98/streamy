import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { markSubmitted, parseAnswers, updateAnswers } from "@/lib/applyPacket";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const row = await prisma.jobApplication.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...row, answers: parseAnswers(row.answers) });
}

/** {answers: {key: value}} edits answers; {status: "submitted"} records sending it by hand. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body?.status === "submitted") {
    await markSubmitted(id).catch(() => null);
    return NextResponse.json({ ok: true });
  }
  if (!body?.answers || typeof body.answers !== "object") return NextResponse.json({ error: "answers required" }, { status: 400 });
  const answers = await updateAnswers(id, body.answers);
  if (!answers) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, answers });
}
