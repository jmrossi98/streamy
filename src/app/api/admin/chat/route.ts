import {
  CLAUDE_MEMORY_CONTEXT_HEADER,
  getCareerContext,
  getVaultIndex,
  splitVaultHits,
  VAULT_CONTEXT_HEADER,
} from "@/lib/vaultIndex";
import { isVaultConfigured, listVaultFiles, readVaultNote } from "@/lib/vault";
import { isReadableNote } from "@/lib/vaultRules";
import {
  AI_CHATS_DIR,
  buildRecentChatsBlock,
  CHAT_HISTORY_CONTEXT_HEADER,
  chatNoteSuffix,
  isRecentChatQuestion,
  newestChatNotes,
} from "@/lib/sharedVaultRules";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import { completeOllama, isOllamaConfigured, streamOllamaChat } from "@/lib/ollama";
import { complete, getRoute, streamChat } from "@/lib/llm";
import { isRemoteBackend, normalizeBackend } from "@/lib/chatModels";
import {
  hasUserTurn,
  isCareerQuestion,
  latestUserQuery,
  prepareChatMessages,
  shouldIncludeStatus,
  shouldSearch,
  systemPromptFor,
  withContext,
  worthRetrieving,
} from "@/lib/chatLimits";
import { buildStatusContext } from "@/lib/chatContext";
import { recordAssistantReply, recordAssistantUsage } from "@/lib/assistantUsage";
import { createReplyCollector, failureNote } from "@/lib/chatTranscriptRules";
import {
  buildSharedContextBlock,
  getSharedContext,
  isSharedContextConfigured,
} from "@/lib/sharedContext";
import {
  buildDocsContextBlock,
  getDocsIndex,
  isDocsRetrievalConfigured,
  searchDocs,
} from "@/lib/docsRetrieval";
import { getSnapshot } from "@/lib/chatStatus";
import { runAssistantTurn, type LoopBackend } from "@/lib/assistantToolLoop";
import { LOCAL_LIMITS, REMOTE_LIMITS } from "@/lib/assistantToolRules";
import { isWebSearchConfigured } from "@/lib/webSearch";
import { skillsForPrompt } from "@/lib/skillRunner";
import { skillsPrompt } from "@/lib/skillRunnerRules";

/**
 * Admin chat proxy. Three slots, chosen per request by the panel: the
 * self-hosted model, an open-weight model, or Claude. Which cloud provider
 * answers the two metered slots (OpenRouter, or Anthropic directly) and on
 * which model is the admin-editable routing in llm.ts, not this file.
 *
 * The local model has no authentication of its own and is reachable from this
 * box over Tailscale, so this route is the only thing in front of it. The
 * cloud slots are metered, so this route is also the only thing between an
 * unauthenticated request and a bill. Admin only, re-checked against the
 * database on every request, for both reasons.
 *
 * The upstream stream is piped straight through rather than buffered: at ~26
 * tok/s a buffered reply reads as a hang. Both cloud clients rewrite their
 * wire format into the same NDJSON shape, so the browser parses one format
 * regardless of who answered.
 */
export const dynamic = "force-dynamic";
// Node runtime, not edge: requireAdmin needs Prisma.
export const runtime = "nodejs";

/**
 * The same stream, with everything that passes through it kept and saved
 * against the turn when it finishes.
 *
 * Pulled by hand rather than `tee()`d: a tee buffers whatever its slower
 * branch has not read, and this must never hold the browser's copy back. The
 * save also runs when the admin navigates away mid-answer, so a half-read
 * reply is recorded as the half that was generated.
 */
function recordingStream(source: ReadableStream<Uint8Array>, usageId: string | null): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const collector = createReplyCollector();
  let saved = false;
  const save = () => {
    if (saved) return;
    saved = true;
    void recordAssistantReply(usageId, collector.text());
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          save();
          controller.close();
          return;
        }
        collector.push(value);
        controller.enqueue(value);
      } catch (err) {
        save();
        controller.error(err);
      }
    },
    cancel(reason) {
      save();
      return reader.cancel(reason);
    },
  });
}

export async function POST(request: Request) {
  // Kept rather than discarded: the admin's own name is what the usage log
  // records, for the same reason AuditLogEntry stores a name and not an id.
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    messages?: unknown;
    webSearch?: unknown;
    backend?: unknown;
    stackStatus?: unknown;
    sessionId?: unknown;
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
  // The saved chat this turn belongs to, so its own copy in the vault is never
  // handed back to it as "a past conversation".
  const sessionId = typeof body.sessionId === "string" && /^[a-z0-9]{8,40}$/i.test(body.sessionId) ? body.sessionId : null;

  // Resolved once, up front: the routing can change between requests, and
  // the investigation loop and the answer must agree on who is answering.
  const route = remote ? await getRoute(backend === "claude" ? "chatClaude" : "chatOpen") : null;
  if (remote && !route) {
    return NextResponse.json(
      {
        error:
          backend === "open"
            ? "The open-weight model isn't configured - OPENROUTER_API_KEY is unset on the server."
            : "Cloud models aren't configured - set OPENROUTER_API_KEY or ANTHROPIC_API_KEY on the server.",
      },
      { status: 503 }
    );
  }
  if (!remote && !isOllamaConfigured()) {
    return NextResponse.json(
      { error: "Chat is not configured - OLLAMA_URL is unset on the server." },
      { status: 503 }
    );
  }

  let messages = prepareChatMessages(body.messages, systemPromptFor(backend));
  if (!hasUserTurn(messages)) {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  // Recorded once the turn is known to be real, but before the model is
  // called: what the visitors log is reporting is that the assistant was
  // *used*, which is true whether or not the model then answers successfully.
  // Awaited rather than fired and forgotten so a turn can't outlive its own
  // log row on a process that exits mid-stream.
  const usageId = await recordAssistantUsage({
    actorName: admin.name,
    backend,
    prompt: latestUserQuery(messages) ?? "",
    headers: request.headers,
  });

  // Opt-out rather than opt-in, unlike search: this panel exists to answer
  // questions about this stack, and the common case is wanting the answer to
  // be about the real one. Snapshots are memoised for a few seconds so a
  // back-and-forth doesn't re-probe every service per message.
  // Filler is answered from the transcript. Handing a model 22 lines of probe
  // output followed by "hi" gets a health summary in reply to a greeting.
  const statusQuery = latestUserQuery(messages);
  if (body.stackStatus !== false && statusQuery && shouldIncludeStatus(statusQuery)) {
    try {
      const snapshot = await getSnapshot();
      messages = withContext(
        messages,
        buildStatusContext(snapshot.statuses, snapshot.containers, snapshot.logs)
      );
    } catch (err) {
      // Answering without live state beats failing the turn -- the model is
      // told in its prompt to say so when no status block is present.
      console.error("[chat] stack status snapshot failed:", err);
    }
  }

  // The Claude Code skills mediabox can run, so the model can propose one as
  // a card the admin taps (skillRunnerRules.ts). Every turn, not gated like
  // the status block: "redeploy infra" or a run's result arriving are not
  // stack questions by shouldIncludeStatus's measure. The list is cached for
  // five minutes, and an unreachable runner just means no skills this turn.
  try {
    const skills = await skillsForPrompt();
    if (skills) messages = withContext(messages, { role: "system", content: skillsPrompt(skills) });
  } catch (err) {
    console.error("[chat] skill list failed:", err);
  }

  // The admin's own documentation, retrieved for this specific question.
  // Gated on there being a real question -- the same filler check search
  // uses, since retrieving against "hi" returns whatever chunk happens to
  // contain a common word and then the model dutifully uses it.
  //
  // Until 2026-10-24 this reused shouldSearch outright, which also skips
  // anything naming the homelab ("my server", "jellyfin") because the *web*
  // knows nothing about it -- so the docs and vault were left out of exactly
  // the stack questions they are about. The cloud models now get them on any
  // real question; the local model keeps the narrower gate, since its 8k
  // context already carries the status block on those questions.
  const docsQuery = latestUserQuery(messages);
  const retrieve = docsQuery != null && (remote ? worthRetrieving(docsQuery) : shouldSearch(docsQuery));
  if (isDocsRetrievalConfigured() && docsQuery && retrieve) {
    try {
      const index = await getDocsIndex();
      const block = index && buildDocsContextBlock(searchDocs(index, docsQuery));
      if (block) messages = withContext(messages, { role: "system", content: block });
    } catch (err) {
      // Answering without the docs beats failing the turn.
      console.error("[chat] docs retrieval failed:", err);
    }
  }

  // The admin's Obsidian vault, retrieved the same way as the docs: notes on
  // plans, the homelab, ideas, resumes -- things written down that no repo
  // holds -- and Claude Code's memory from the other machines, framed apart
  // because another model wrote it. A question about the admin's own career
  // gets the whole resume set instead of fragments: the cloud models have the
  // room; the local model's 8k context gets a slice.
  if (docsQuery && retrieve) {
    let career = false;
    if (isCareerQuestion(docsQuery)) {
      try {
        const block = await getCareerContext(remote ? 40_000 : 5_000);
        if (block) {
          messages = withContext(messages, { role: "system", content: block });
          career = true;
        }
      } catch (err) {
        console.error("[chat] resume context failed:", err);
      }
    }
    try {
      const vault = await getVaultIndex();
      if (vault) {
        const { notes, memory, chats } = splitVaultHits(searchDocs(vault, docsQuery, remote ? 12 : 6), {
          dropResume: career,
          currentChatSuffix: sessionId ? chatNoteSuffix(sessionId) : null,
        });
        const limit = remote ? 6 : 3;
        const noteBlock = buildDocsContextBlock(notes.slice(0, limit), VAULT_CONTEXT_HEADER);
        if (noteBlock) messages = withContext(messages, { role: "system", content: noteBlock });
        const memoryBlock = buildDocsContextBlock(memory.slice(0, remote ? 4 : 2), CLAUDE_MEMORY_CONTEXT_HEADER);
        if (memoryBlock) messages = withContext(messages, { role: "system", content: memoryBlock });
        const chatBlock = buildDocsContextBlock(chats.slice(0, remote ? 4 : 2), CHAT_HISTORY_CONTEXT_HEADER);
        if (chatBlock) messages = withContext(messages, { role: "system", content: chatBlock });
      }
    } catch (err) {
      // Answering without the notes beats failing the turn.
      console.error("[chat] vault retrieval failed:", err);
    }
  }

  // A chat shared with a Claude Code session: turns marked as from Claude
  // Code happened there, and the admin may carry on there afterwards.
  if (sessionId) {
    try {
      const linked = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId: admin.id, claudeSessionId: { not: null } },
        select: { id: true },
      });
      if (linked) {
        messages = withContext(messages, {
          role: "system",
          content:
            "This chat is shared with a Claude Code session on the admin's machine. Earlier turns may have happened " +
            "there (Claude Code worked with full tool access; its tool output is not in this transcript), and the " +
            "admin may continue this conversation there after you answer. Pick up where it left off.",
        });
      }
    } catch (err) {
      console.error("[chat] linked-session check failed:", err);
    }
  }

  // "What did we talk about last time", "what did Claude Code do today": the
  // words name a time, not a topic, so keyword search finds nothing. The
  // newest conversations from every assistant are listed instead, with the
  // newest one's text. Read live rather than from the index, which lags a few
  // minutes behind the chat that just ended.
  if (docsQuery && isVaultConfigured() && isRecentChatQuestion(docsQuery)) {
    try {
      const entries = await listVaultFiles(AI_CHATS_DIR, isReadableNote, 600);
      const list = newestChatNotes(entries, sessionId, 8);
      const latest = list[0] ? { ref: list[0], text: await readVaultNote(list[0].path) } : null;
      const block = buildRecentChatsBlock(list, latest, remote ? 24_000 : 4_000);
      if (block) messages = withContext(messages, { role: "system", content: block });
    } catch (err) {
      console.error("[chat] recent conversations read failed:", err);
    }
  }

  // What the other assistants already know. Unconditional, unlike search:
  // this panel's whole weakness is starting from nothing every time, and the
  // block is small and cheap. A failure to read it costs the context, never
  // the answer.
  if (isSharedContextConfigured()) {
    try {
      const shared = await getSharedContext();
      const block = shared && buildSharedContextBlock(shared);
      if (block) messages = withContext(messages, { role: "system", content: block });
    } catch (err) {
      console.error("[chat] shared context read failed:", err);
    }
  }

  // Web tools since 2026-10-24: the model decides when to search or read a
  // page (assistantToolRules.ts), on every backend, instead of a toggle that
  // searched every message. The toggle is now "Always search": it runs one
  // search on the question up front, and the model can still look further.
  // shouldSearch still guards the forced search -- "hey" once came back as a
  // dictionary definition of the word, and the web knows nothing about this
  // homelab. Offered on any real question; a greeting gets neither tools nor
  // the extra step.
  const query = latestUserQuery(messages);
  const realQuestion = query != null && shouldIncludeStatus(query);
  const web = isWebSearchConfigured() && realQuestion;
  const forceSearch = web && body.webSearch === true && query && shouldSearch(query) ? query : null;
  // A question on a cloud model: let it look at the stack for itself
  // (read-only commands on mediabox) rather than answer from the snapshot.
  // Same gate as the status block. The local model doesn't drive the
  // diagnostics -- several rounds of picking commands is beyond a 4B model,
  // and each would take longer on the card than looking by hand.
  const diag = !!route && body.stackStatus !== false && realQuestion;

  try {
    // request.signal so navigating away actually stops generation -- on the
    // local card that frees the GPU, and on a metered backend it stops paying
    // for tokens nobody will read.
    let stream: ReadableStream<Uint8Array>;
    if (diag || web) {
      const backendFns: LoopBackend = route
        ? {
            // Low effort and a short ceiling: a step writes a few tool lines,
            // and on a model that reasons by default the reasoning would
            // otherwise outweigh them.
            step: async (convo) =>
              (await complete(route, convo, { maxTokens: 300, timeoutMs: 60_000, effort: "low" })).text,
            answer: (convo, signal) => streamChat(route, convo, signal),
          }
        : {
            step: (convo, signal) => completeOllama(convo, { maxTokens: 120, signal }),
            answer: (convo, signal) => streamOllamaChat(convo, signal),
          };
      stream = await runAssistantTurn({
        messages,
        backend: backendFns,
        diag,
        web,
        forceSearch,
        limits: route ? REMOTE_LIMITS : LOCAL_LIMITS,
        actorName: admin.name,
        signal: request.signal,
      });
    } else {
      stream = route
        ? await streamChat(route, messages, request.signal)
        : await streamOllamaChat(messages, request.signal);
    }

    return new Response(recordingStream(stream, usageId), {
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
    // The transcript should say the turn got no answer, and why.
    await recordAssistantReply(usageId, failureNote(message));
    return NextResponse.json(
      { error: `Couldn't reach the model: ${message}` },
      { status: 502 }
    );
  }
}
