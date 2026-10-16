import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { listCredentialTargets, updateCredential } from "@/lib/credentials";
import { logAudit } from "@/lib/auditLog";

/**
 * Outside-provider logins and API keys, for rotating them from the admin
 * pages (see lib/credentials.ts). Admin only. Secrets go in and never come
 * back out: GET returns masked hints, POST answers with a message, and the
 * audit row records which fields changed, never their values.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json({ targets: await listCredentialTargets() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  const name = typeof body.name === "string" ? body.name.slice(0, 80) : key;
  const values = body.values && typeof body.values === "object" ? (body.values as Record<string, unknown>) : {};
  if (!key) return NextResponse.json({ ok: false, message: "key required" }, { status: 400 });

  const result = await updateCredential(key, values);
  logAudit(admin.name, result.ok ? "credentials.update" : "credentials.update.failed", name, result.changed.join(", ") || result.message);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
