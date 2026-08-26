/**
 * Ollama client for the admin chat panel.
 *
 * The model runs on mediabox (GTX 1050 Ti, 4GB) and is reachable from
 * Lightsail over Tailscale. It is deliberately bound to loopback + the tailnet
 * and has **no authentication of its own** -- so the only thing standing in
 * front of it is Streamy's admin gate. Every call here must sit behind
 * requireAdmin().
 *
 * Env:
 *   OLLAMA_URL    e.g. http://100.84.77.56:11434 ; the feature is off when unset
 *   OLLAMA_MODEL  defaults to the 3B build that fits in 4GB alongside Jellyfin
 */

export const DEFAULT_MODEL = "qwen2.5:3b-instruct-q5_K_M";

/** Generous: a 3B model at ~26 tok/s needs room for a long answer. */
const REQUEST_TIMEOUT_MS = 120_000;
/** Shorter, because this one only asks "are you there". */
const PING_TIMEOUT_MS = 5_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function isOllamaConfigured(): boolean {
  return !!process.env.OLLAMA_URL;
}

function baseUrl(): string {
  return (process.env.OLLAMA_URL ?? "").replace(/\/$/, "");
}

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_MODEL;
}

/**
 * Streams a chat completion as newline-delimited JSON, exactly as Ollama emits
 * it. Streaming rather than buffering because at ~26 tok/s a paragraph takes
 * long enough that a non-streaming reply reads as a hang.
 *
 * Returns the upstream body so the route can pipe it straight through without
 * parsing and re-serialising every token.
 */
export async function streamOllamaChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  if (!isOllamaConfigured()) {
    throw new Error("OLLAMA_URL is not set");
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel(),
      messages,
      stream: true,
      options: {
        // Keeps the KV cache inside the VRAM budget. Raising this is what
        // pushes the model off the GPU and starts costing Jellyfin frames.
        num_ctx: 8192,
      },
    }),
    signal: combined,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama returned HTTP ${res.status}`);
  }
  return res.body;
}

export type OllamaStatus =
  | { ok: true; model: string; loaded: boolean }
  | { ok: false; error: string };

/** Cheap reachability probe, used by the panel and by the health check. */
export async function getOllamaStatus(): Promise<OllamaStatus> {
  if (!isOllamaConfigured()) return { ok: false, error: "OLLAMA_URL is not set" };

  try {
    const res = await fetch(`${baseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const data = (await res.json()) as { models?: { name?: string }[] };
    const wanted = ollamaModel();
    const loaded = (data.models ?? []).some((m) => m.name === wanted);
    return { ok: true, model: wanted, loaded };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
