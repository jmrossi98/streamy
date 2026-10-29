/**
 * The "claudecode" provider: an admin-chat turn answered by Claude Code on
 * mediabox, signed in to the admin's Claude plan, through the skill runner's
 * /chat lane. Server-only (the runner token). Pure parts: claudeCodeLlmRules.ts.
 *
 * The runner answers asynchronously: POST /chat starts a run, and its record
 * (GET /runs/<id>) carries the reply so far in `chat.text`. This polls that
 * record and re-emits it as the same NDJSON every other provider streams, so
 * the chat's reader and the reply collector need nothing new -- apart from
 * one extra line kind, `{"ask": ...}`, for a command Claude Code wants Jake
 * to approve (answered through the existing run-permission route).
 */
import { createHash, randomBytes } from "node:crypto";
import { cancelRun, getRun, startChatRun } from "./skillRunner";
import { isFinished, type SkillRun } from "./skillRunnerRules";
import type { ChatMessage } from "./ollama";
import {
  CHAT_MAX_MS,
  CHAT_POLL_MS,
  askChange,
  conversationKey,
  failureReason,
  planTurn,
  renderChatPrompt,
  replyDelta,
} from "./claudeCodeLlmRules";

const encoder = new TextEncoder();
const ndjson = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");
/** Consecutive failed polls (~30 s or more) before the turn is given up on. */
const MAX_MISSES = 50;
/**
 * While Claude Code waits on a permission tap or a long command, nothing is
 * written for minutes; a proxy cuts a silent stream ("Lost connection to the
 * model") and the permission card goes with it. A ping line keeps it open;
 * the browser ignores lines it has no use for.
 */
const HEARTBEAT_MS = 10_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Which runner session wrote which reply: a fingerprint of the reply to the
 * runner's chat id. In memory (kept across hot reloads); after a deploy each
 * chat starts its session over once, with the whole conversation.
 */
type Sessions = Map<string, string>;
const SESSIONS_KEY = Symbol.for("streamy.claudeCodeSessions");
function sessions(): Sessions {
  const g = globalThis as unknown as Record<symbol, Sessions | undefined>;
  return (g[SESSIONS_KEY] ??= new Map());
}
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex");
const MAX_TRACKED = 500;

function remember(reply: string, chatId: string) {
  const map = sessions();
  map.set(fingerprint(conversationKey(reply)), chatId);
  while (map.size > MAX_TRACKED) map.delete(map.keys().next().value as string);
}

/** A chat id the runner accepts: the saved chat's own id, or a fresh one for a chat not saved yet. */
function runnerChatId(chatId: string | null): string {
  return chatId && /^[A-Za-z0-9_-]{6,64}$/.test(chatId) ? chatId : `new-${randomBytes(8).toString("hex")}`;
}

/** Starts the turn in the chat's session; throws with a sentence for the chat when it can't. */
async function start(
  messages: ChatMessage[],
  model: string,
  chatId: string | null
): Promise<{ runId: string; chatId: string }> {
  const map = sessions();
  let plan = planTurn(messages, (prior) => map.has(fingerprint(prior)));
  const live = plan.reset ? undefined : map.get(fingerprint(plan.prior));
  const target = live ?? runnerChatId(chatId);
  const send = (p: typeof plan) =>
    startChatRun({
      prompt: p.prompt,
      by: "admin-chat",
      chatId: target,
      reset: p.reset,
      ...(model ? { model } : {}),
      ...(p.images.length > 0 ? { images: p.images } : {}),
    });
  let r = await send(plan);
  if (!r.ok && r.status === 409 && /no session/i.test(r.error)) {
    // The runner has no session for it (restarted, or reset elsewhere): send it all.
    plan = planTurn(messages, () => false);
    r = await send(plan);
  }
  if (r.ok) {
    // That reply is no longer the end of the conversation.
    if (plan.prior) map.delete(fingerprint(plan.prior));
    return { runId: r.data.id, chatId: target };
  }
  if (r.status === 404) throw new Error("The skill runner on mediabox has no /chat lane yet - deploy the mediabox-infra update.");
  if (r.status === 409 && /still answering/i.test(r.error)) throw new Error("This chat is still answering the last message.");
  throw new Error(r.error);
}

/** A one-off turn with the whole conversation and no session, for complete(). */
async function startOneOff(messages: ChatMessage[], model: string): Promise<string> {
  const { prompt, images } = renderChatPrompt(messages);
  const r = await startChatRun({
    prompt,
    by: "admin-chat",
    ...(model ? { model } : {}),
    ...(images.length > 0 ? { images } : {}),
  });
  if (r.ok) return r.data.id;
  throw new Error(r.error);
}

/** The reply text a run holds: the streamed chat text, else its summary once it ends. */
function textOf(run: SkillRun): string {
  if (run.chatText) return run.chatText;
  return isFinished(run.status) ? (run.summary ?? "") : "";
}

/** Streams one chat turn from Claude Code as NDJSON. */
export async function streamClaudeCodeChat(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal,
  chatId: string | null = null
): Promise<ReadableStream<Uint8Array>> {
  const { runId, chatId: runnerChat } = await start(messages, model, chatId);
  const deadline = Date.now() + CHAT_MAX_MS;
  let stopped = false;
  // The admin pressed Stop or left: the run on mediabox stops too, once.
  const stop = () => {
    if (stopped) return;
    stopped = true;
    void cancelRun(runId);
  };
  signal?.addEventListener("abort", stop, { once: true });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = "";
      let shownAsk: string | null = null;
      let misses = 0;
      let lastWrite = Date.now();
      const emit = (obj: unknown) => {
        if (stopped) return;
        lastWrite = Date.now();
        controller.enqueue(ndjson(obj));
      };
      try {
        for (;;) {
          await sleep(CHAT_POLL_MS, signal);
          if (stopped || signal?.aborted) break;
          if (Date.now() > deadline) {
            emit({ error: `Claude Code took longer than ${Math.round(CHAT_MAX_MS / 60_000)} minutes; the run was stopped.` });
            stop();
            break;
          }
          if (Date.now() - lastWrite >= HEARTBEAT_MS) emit({ ping: true });
          const r = await getRun(runId);
          if (!r.ok) {
            if (++misses >= MAX_MISSES) {
              emit({ error: `Lost track of the Claude Code run: ${r.error}` });
              break;
            }
            continue;
          }
          misses = 0;
          const run = r.data;
          const next = replyDelta(sent, textOf(run));
          sent = next.sent;
          if (next.delta) emit({ message: { content: next.delta } });
          const ask = askChange(runId, shownAsk, isFinished(run.status) ? null : run.waiting);
          if (ask) {
            shownAsk = ask.ask?.id ?? null;
            emit(ask);
          }
          if (isFinished(run.status)) {
            if (run.status !== "succeeded" && run.status !== "cancelled") emit({ error: failureReason(run) });
            // The session now ends with this reply: the next message continues it.
            if ((run.status === "succeeded" || run.status === "cancelled") && sent.trim()) remember(sent, runnerChat);
            break;
          }
        }
      } catch (err) {
        emit({ error: `Claude Code stream failed: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        signal?.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // Already cancelled by the reader.
        }
      }
    },
    cancel() {
      stop();
    },
  });
}

/**
 * One buffered turn: polls until the run ends and returns its reply. The
 * chat route streams instead; this exists so a stray `complete()` on a
 * Claude Code route answers rather than crashes.
 */
export async function completeClaudeCode(
  messages: ChatMessage[],
  model: string,
  timeoutMs = CHAT_MAX_MS
): Promise<{ text: string; model: string }> {
  const runId = await startOneOff(messages, model);
  const deadline = Date.now() + Math.min(timeoutMs, CHAT_MAX_MS);
  let misses = 0;
  while (Date.now() < deadline) {
    await sleep(CHAT_POLL_MS * 2);
    const r = await getRun(runId);
    if (!r.ok) {
      if (++misses >= MAX_MISSES) throw new Error(`Lost track of the Claude Code run: ${r.error}`);
      continue;
    }
    misses = 0;
    if (isFinished(r.data.status)) {
      if (r.data.status !== "succeeded") throw new Error(failureReason(r.data));
      return { text: textOf(r.data), model: `claude-code/${model}` };
    }
  }
  void cancelRun(runId);
  throw new Error("Claude Code took too long to answer.");
}
