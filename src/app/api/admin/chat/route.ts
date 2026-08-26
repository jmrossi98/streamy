import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isOllamaConfigured, streamOllamaChat } from "@/lib/ollama";
import {
  buildSearchContext,
  hasUserTurn,
  latestUserQuery,
  prepareChatMessages,
  shouldSearch,
  withSearchContext,
} from "@/lib/chatLimits";
import { isWebSearchConfigured, searchWeb } from "@/lib/webSearch";

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

  let body: { messages?: unknown; webSearch?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let messages = prepareChatMessages(body.messages);
  if (!hasUserTurn(messages)) {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  // Searched unconditionally when the toggle is on, rather than left to the
  // model to decide -- a 3B model is not a reliable judge of when it needs a
  // lookup, which is the whole reason this is a switch.
  if (body.webSearch === true && isWebSearchConfigured()) {
    const query = latestUserQuery(messages);
    // Greetings and "can you search?" are answered from the transcript. Running
    // a lookup on them is what turned "hey" into a definition of the word.
    if (query && shouldSearch(query)) {
      try {
        const results = await searchWeb(query);
        if (results.length > 0) {
          messages = withSearchContext(messages, buildSearchContext(query, results));
        }
      } catch (err) {
        // A search failure degrades to answering without it. Losing the whole
        // reply because the search box is down would be worse than an
        // ungrounded answer the model is told to hedge.
        console.error("[chat] web search failed:", err);
      }
    }
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
