import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getApplicantProfile, setApplicantProfile } from "@/lib/applyPacket";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return NextResponse.json(await getApplicantProfile());
}

export async function PUT(request: Request) {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Profile required" }, { status: 400 });
  return NextResponse.json(await setApplicantProfile(body));
}
