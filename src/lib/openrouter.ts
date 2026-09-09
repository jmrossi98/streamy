/**
 * OpenRouter client for the admin chat panel.
 *
 * One key reaches both the cheap open-weight models and Claude, which is the
 * whole reason this is OpenRouter rather than two provider SDKs: the panel's
 * model switch becomes a change of string, not a change of code path.
 *
 * Unlike the Ollama backend, this one costs money per token, so the key is
 * expected to carry a spend limit set on OpenRouter's side. Nothing here can
 * enforce that -- a runaway loop in this process would bill until the credit
 * cap stops it, and the cap is the only real backstop.
 *
 * Read-only by construction: this is a chat-completion call with no tools, no
 * function calling, and no way for a reply to reach anything but the
 * transcript. Keeping it that way is the point of the feature.
 *
 * Env:
 *   OPENROUTER_API_KEY       an inference key (openrouter.ai/keys). NOT a
 *                            management/provisioning key -- those only manage
 *                            other keys and are rejected by this endpoint.
 *   OPENROUTER_OPEN_MODEL    overrides the open-weight model id
 *   OPENROUTER_CLAUDE_MODEL  overrides the Claude model id
 */

import type { ChatMessage } from "./ollama";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPEN_MODEL,
  type ChatBackendId,
} from "./chatModels";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Longer than the local model's, despite the far higher tokens/sec: a frontier
 * model asked a hard question can think for a while before the first token,
 * and cutting that off wastes tokens already paid for.
 */
const REQUEST_TIMEOUT_MS = 180_000;

export function isOpenRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/** The upstream model id for a backend choice. */
export function openRouterModel(backend: ChatBackendId): string {
  return backend === "claude"
    ? process.env.OPENROUTER_CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL
    : process.env.OPENROUTER_OPEN_MODEL || DEFAULT_OPEN_MODEL;
}

export type SseEvent =
  | { kind: "content"; text: string }
  | { kind: "done" }
  | { kind: "ignore" };

/**
 * Interprets one line of an OpenAI-style SSE stream.
 *
 * Pure and exported for its tests: the stream shape is the fiddly part of this
 * integration, and the failure mode of getting it wrong is a panel that shows
 * nothing while the tokens are billed anyway.
 *
 * Two things here are easy to get wrong. OpenRouter sends SSE *comments*
 * (lines starting with ":") purely to hold the connection open, and it sends a
 * final usage-only chunk with no delta just before [DONE] -- both must be
 * skipped rather than treated as an empty reply.
 */
export function parseSseLine(line: string): SseEvent {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  // Keep-alive comment, per the SSE spec.
  if (trimmed.startsWith(":")) return { kind: "ignore" };
  if (!trimmed.startsWith("data:")) return { kind: "ignore" };

  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return { kind: "done" };

  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | null } }[];
    };
    const text = parsed.choices?.[0]?.delta?.content;
    // The trailing usage chunk has choices: [] or a delta with no content.
    return typeof text === "string" && text.length > 0
      ? { kind: "content", text }
      : { kind: "ignore" };
  } catch {
    // A malformed line isn't worth killing a paid-for stream over.
    return { kind: "ignore" };
  }
}

/**
 * Rewrites OpenRouter's SSE into the newline-delimited JSON the panel already
 * parses for Ollama.
 *
 * Translating here rather than teaching the client a second wire format keeps
 * OpsChat's reader identical for all three backends -- the switch changes who
 * answers, not how the answer arrives.
 */
function sseToNdjson(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      // A chunk can split mid-line; the tail waits for the rest.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseSseLine(line);
        if (event.kind === "content") {
          controller.enqueue(
            encoder.encode(JSON.stringify({ message: { content: event.text } }) + "\n")
          );
        }
      }
    },
    flush(controller) {
      if (!buffer.trim()) return;
      const event = parseSseLine(buffer);
      if (event.kind === "content") {
        controller.enqueue(
          encoder.encode(JSON.stringify({ message: { content: event.text } }) + "\n")
        );
      }
    },
  });
}

/**
 * Streams a chat completion, returning NDJSON in Ollama's shape.
 *
 * Streams rather than buffers for the same reason the local backend does: a
 * long answer arriving all at once reads as a hang.
 */
export async function streamOpenRouterChat(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // Attribution on OpenRouter's own dashboard, so spend is legible per app
      // rather than as one undifferentiated total.
      "X-Title": "Streamy",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: combined,
  });

  if (!res.ok || !res.body) {
    // OpenRouter puts the useful part in the body -- an unknown model id and a
    // spent-out credit balance are both plain HTTP 4xx without it.
    const detail = await res.text().catch(() => "");
    const parsed = (() => {
      try {
        return (JSON.parse(detail) as { error?: { message?: string } }).error?.message;
      } catch {
        return undefined;
      }
    })();
    throw new Error(`OpenRouter returned HTTP ${res.status}${parsed ? `: ${parsed}` : ""}`);
  }

  return res.body.pipeThrough(sseToNdjson());
}
