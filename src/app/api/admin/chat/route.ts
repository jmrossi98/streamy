import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isOllamaConfigured, streamOllamaChat } from "@/lib/ollama";
import {
  isOpenRouterConfigured,
  openRouterModel,
  streamOpenRouterChat,
} from "@/lib/openrouter";
import { isRemoteBackend, normalizeBackend } from "@/lib/chatModels";
import {
  buildSearchContext,
  hasUserTurn,
  latestUserQuery,
  prepareChatMessages,
  shouldSearch,
  systemPromptFor,
  withContext,
} from "@/lib/chatLimits";
import { buildStatusContext } from "@/lib/chatContext";
import { getStatusSnapshot } from "@/lib/chatStatus";
import { isWebSearchConfigured, searchWeb } from "@/lib/webSearch";

/**
 * Admin chat proxy. Three backends, chosen per request by the panel:
 * the self-hosted model, an open-weight model via OpenRouter, or Claude via
 * OpenRouter.
 *
 * The local model has no authentication of its own and is reachable from this
 * box over Tailscale, so this route is the only thing in front of it. The
 * OpenRouter backends are metered, so this route is also the only thing
 * between an unauthenticated request and a bill. Admin only, re-checked
 * against the database on every request, for both reasons.
 *
 * The upstream stream is piped straight through rather than buffered: at ~26
 * tok/s a buffered reply reads as a hang. OpenRouter's SSE is rewritten into
 * the same NDJSON shape by the client module, so the browser parses one format
 * regardless of who answered.
 */
export const dynamic = "force-dynamic";
// Node runtime, not edge: requireAdmin needs Prisma.
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    messages?: unknown;
    webSearch?: unknown;
    backend?: unknown;
    stackStatus?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // An unrecognised backend falls back to the free local one rather than
  // erroring -- and never to a metered one.
  const backend = normalizeBackend(body.backend);
  const remote = isRemoteBackend(backend);

  if (remote && !isOpenRouterConfigured()) {
    return NextResponse.json(
      { error: "Cloud models aren't configured — OPENROUTER_API_KEY is unset on the server." },
      { status: 503 }
    );
  }
  if (!remote && !isOllamaConfigured()) {
    return NextResponse.json(
      { error: "Chat is not configured — OLLAMA_URL is unset on the server." },
      { status: 503 }
    );
  }

  let messages = prepareChatMessages(body.messages, systemPromptFor(backend));
  if (!hasUserTurn(messages)) {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  // Opt-out rather than opt-in, unlike search: this panel exists to answer
  // questions about this stack, and the common case is wanting the answer to
  // be about the real one. Snapshots are memoised for a few seconds so a
  // back-and-forth doesn't re-probe every service per message.
  if (body.stackStatus !== false) {
    try {
      messages = withContext(messages, buildStatusContext(await getStatusSnapshot()));
    } catch (err) {
      // Answering without live state beats failing the turn -- the model is
      // told in its prompt to say so when no status block is present.
      console.error("[chat] stack status snapshot failed:", err);
    }
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
          messages = withContext(messages, buildSearchContext(query, results));
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
    // request.signal so navigating away actually stops generation -- on the
    // local card that frees the GPU, and on a metered backend it stops paying
    // for tokens nobody will read.
    const stream = remote
      ? await streamOpenRouterChat(messages, openRouterModel(backend), request.signal)
      : await streamOllamaChat(messages, request.signal);

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
    console.error(`[chat] ${backend} request failed:`, message);
    return NextResponse.json(
      { error: `Couldn't reach the model: ${message}` },
      { status: 502 }
    );
  }
}
