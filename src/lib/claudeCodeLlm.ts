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
import { cancelRun, getRun, startChatRun } from "./skillRunner";
import { isFinished, type SkillRun } from "./skillRunnerRules";
import type { ChatMessage } from "./ollama";
import {
  CHAT_MAX_MS,
  CHAT_POLL_MS,
  askChange,
  failureReason,
  renderChatPrompt,
  replyDelta,
} from "./claudeCodeLlmRules";

const encoder = new TextEncoder();
const ndjson = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");
/** Consecutive failed polls (~30 s or more) before the turn is given up on. */
const MAX_MISSES = 50;

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

/** Starts the run; throws with a sentence for the chat when it can't. */
async function start(messages: ChatMessage[], model: string): Promise<string> {
  const { prompt, images } = renderChatPrompt(messages);
  const r = await startChatRun({
    prompt,
    by: "admin-chat",
    ...(model ? { model } : {}),
    ...(images.length > 0 ? { images } : {}),
  });
  if (r.ok) return r.data.id;
  if (r.status === 404) throw new Error("The skill runner on mediabox has no /chat lane yet - deploy the mediabox-infra update.");
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
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const runId = await start(messages, model);
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
      const emit = (obj: unknown) => {
        if (!stopped) controller.enqueue(ndjson(obj));
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
            if (run.status !== "succeeded") emit({ error: failureReason(run) });
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
  const runId = await start(messages, model);
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
