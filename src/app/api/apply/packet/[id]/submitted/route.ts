import { NextResponse } from "next/server";
import { isValidApplyToken, markSubmitted } from "@/lib/applyPacket";

export const runtime = "nodejs";

/** The userscript saw the application go through. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isValidApplyToken(request.headers.get("x-apply-token")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await markSubmitted(id).catch(() => null);
  return NextResponse.json({ ok: true });
}
