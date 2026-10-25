import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { resetRouting, saveRouting } from "@/lib/llm";
import { modelsSnapshot, saveChatBackend } from "@/lib/chatBackend";
import { isChatBackendId } from "@/lib/chatModels";
import { parseUseList } from "@/lib/llmRoutingRules";

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
  return NextResponse.json(await modelsSnapshot());
}

export async function PUT(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { routing?: unknown; reset?: unknown; chatBackend?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if ("chatBackend" in body) {
    // Which slot the chat answers on. Strict: junk is refused, not coerced,
    // since the choice decides what gets billed.
    if (!isChatBackendId(body.chatBackend)) return NextResponse.json({ error: "Unknown chat model slot" }, { status: 400 });
    await saveChatBackend(body.chatBackend);
    logAudit(admin.name, "llm.chat-backend", body.chatBackend);
  } else if (body.reset === true) {
    await resetRouting();
    logAudit(admin.name, "llm.routing.reset", "env defaults");
  } else if (Array.isArray(body.reset)) {
    // One panel's rows only: the assistant's chat slots, or the Jobs tab's.
    const uses = parseUseList(body.reset);
    await resetRouting(uses);
    logAudit(admin.name, "llm.routing.reset", `env defaults: ${uses.join(" ")}`);
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
  return NextResponse.json(await modelsSnapshot());
}
