import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { resetRouting, routingSnapshot, saveRouting } from "@/lib/llm";

/**
 * Which provider and model answer each cloud-model job.
 *
 * Admin only, like everything that can spend money. The routing is validated
 * server-side (llmRoutingRules.normalizeRouting) -- the form is data, and a
 * model id is sent upstream verbatim.
 */
export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await routingSnapshot());
}

export async function PUT(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { routing?: unknown; reset?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if (body.reset === true) {
    await resetRouting();
    logAudit(admin.name, "llm.routing.reset", "env defaults");
  } else {
    const saved = await saveRouting(body.routing);
    logAudit(
      admin.name,
      "llm.routing",
      Object.entries(saved)
        .map(([use, r]) => `${use}=${r.provider}:${r.model}`)
        .join(" ")
    );
  }
  return NextResponse.json(await routingSnapshot());
}
