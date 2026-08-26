import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isOllamaConfigured, streamOllamaChat } from "@/lib/ollama";
import { hasUserTurn, prepareChatMessages } from "@/lib/chatLimits";

/**
 * Admin chat proxy to the self-hosted model.
 *
 * The model has no authentication of its own and is reachable from this box
 * over Tailscale, so this route is the only thing in front of it. Admin only,
 * re-checked against the database on every request.
 *
 * The upstream NDJSON stream is piped straight through rather than buffered:
 * at ~26 tok/s a buffered reply reads as a hang.
 */
export const dynamic = "force-dynamic";
// Node runtime, not edge: requireAdmin needs Prisma.
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!isOllamaConfigured()) {
    return NextResponse.json(
      { error: "Chat is not configured — OLLAMA_URL is unset on the server." },
      { status: 503 }
    );
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = prepareChatMessages(body.messages);
  if (!hasUserTurn(messages)) {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  try {
    // request.signal so navigating away actually stops generation on the GPU
    // instead of leaving it churning for a reply nobody will read.
    const stream = await streamOllamaChat(messages, request.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        // The reply is generated token by token; a proxy buffering it would
        // undo the streaming.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] ollama request failed:", message);
    return NextResponse.json(
      { error: `Couldn't reach the model: ${message}` },
      { status: 502 }
    );
  }
}
