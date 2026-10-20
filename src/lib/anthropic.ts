/**
 * Anthropic client, the direct counterpart to openrouter.ts.
 *
 * Exists so prepaid Anthropic credit can be spent: OpenRouter bills its own
 * balance even when the model it relays to is Claude. Same two operations as
 * the OpenRouter module -- a streamed chat in the NDJSON shape the panel
 * already reads, and a buffered completion for background work -- so the
 * dispatch in llm.ts is a switch on the provider, not two code paths.
 *
 * Metered per token with no cap this side; the spend limit on the Console is
 * the only backstop, as it is for OpenRouter. What this module does add is a
 * running month-to-date estimate from the usage figures every response
 * carries, since a plain API key cannot ask the account for its balance.
 *
 * Env:
 *   ANTHROPIC_API_KEY     enables the provider; everything else is optional
 *   ANTHROPIC_MODEL       default model id (see DEFAULT_ANTHROPIC_MODEL)
 *   ANTHROPIC_FALLBACKS   comma-separated same-tier chain tried after it
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/streaming";
import { prisma } from "./db";
import { cached } from "./ttlCache";
import type { ChatMessage } from "./ollama";
import {
  addCall,
  anthropicMaxTokens,
  parseMonthSpend,
  spendMonth,
  supportsEffort,
  textFromContent,
  toAnthropicRequest,
  webSearchToolFor,
  type AnthropicMonthSpend,
  type AnthropicUsage,
  type Effort,
} from "./anthropicRules";
import { ANTHROPIC_MODEL_SUGGESTIONS, DEFAULT_ANTHROPIC_MODEL } from "./llmRoutingRules";

/** As OpenRouter's: a frontier model can think a while before the first token. */
const REQUEST_TIMEOUT_MS = 180_000;
const MODELS_TTL_MS = 60 * 60_000;

export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function anthropicDefaultModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

/** Default chain, head first: the model plus ANTHROPIC_FALLBACKS. */
export function anthropicDefaultChain(): string[] {
  const extra = (process.env.ANTHROPIC_FALLBACKS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([anthropicDefaultModel(), ...extra])];
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  // One client per process: it holds nothing but the key and a connection
  // pool, and the key does not change under a running server.
  return (client ??= new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 }));
}

/**
 * Whether a failure on one model is worth trying the next on.
 *
 * Yes for the model being gone (404), busy (429, 529) or the API being down
 * (5xx, connection). No for anything that says the *request* is wrong -- a
 * bad key or a rejected parameter fails identically on every model, and
 * retrying it is paying to be told so again.
 */
function worthTryingNext(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return status === 404 || status === 429 || status >= 500;
  }
  return false;
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `Anthropic returned HTTP ${err.status ?? "?"}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

type CallOpts = {
  /** The visible-output ceiling; thinking headroom is added on top. */
  maxTokens: number;
  effort?: Effort;
  webSearch?: boolean;
};

function baseParams(model: string, messages: ChatMessage[], opts: CallOpts) {
  const { system, messages: turns } = toAnthropicRequest(messages);
  const params: Omit<Anthropic.MessageCreateParamsNonStreaming, "stream"> = {
    model,
    max_tokens: anthropicMaxTokens(opts.maxTokens),
    messages: turns,
    ...(system ? { system } : {}),
    ...(opts.effort && supportsEffort(model) ? { output_config: { effort: opts.effort } } : {}),
    ...(opts.webSearch
      ? { tools: [webSearchToolFor(model) as unknown as Anthropic.Messages.ToolUnion] }
      : {}),
  };
  return params;
}

const encoder = new TextEncoder();
const ndjson = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");

/**
 * Streams a chat completion as NDJSON in Ollama's shape, trying each model in
 * turn until one accepts the request.
 *
 * Uses the raw event stream rather than the SDK's MessageStream helper so the
 * request is sent -- and a 404/429 surfaces -- *before* this returns, which
 * is where the fallback decision has to be made. Once tokens are flowing a
 * failure is reported into the stream instead; the panel shows `error` lines.
 */
export async function streamAnthropicChat(
  messages: ChatMessage[],
  models: string[],
  signal?: AbortSignal,
  opts: CallOpts = { maxTokens: 2048 }
): Promise<ReadableStream<Uint8Array>> {
  const api = anthropic();
  let lastErr: unknown = new Error("no model to try");
  for (const model of models) {
    let events: Stream<Anthropic.RawMessageStreamEvent>;
    try {
      events = await api.messages.create({ ...baseParams(model, messages, opts), stream: true }, { signal });
    } catch (err) {
      lastErr = err;
      if (worthTryingNext(err)) {
        console.warn(`[anthropic] ${model} unavailable, trying next:`, describe(err));
        continue;
      }
      throw new Error(describe(err));
    }

    const usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };
    let stopReason: string | null = null;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) {
            if (event.type === "message_start") {
              Object.assign(usage, event.message.usage);
            } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              if (event.delta.text) controller.enqueue(ndjson({ message: { content: event.delta.text } }));
            } else if (event.type === "message_delta") {
              stopReason = event.delta.stop_reason;
              // Cumulative figures; the last delta is the whole response.
              usage.output_tokens = event.usage.output_tokens;
              if (event.usage.input_tokens != null) usage.input_tokens = event.usage.input_tokens;
              if (event.usage.cache_read_input_tokens != null) usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
              if (event.usage.cache_creation_input_tokens != null) usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
            }
          }
          if (stopReason === "refusal") {
            controller.enqueue(ndjson({ error: "Claude declined to answer this request." }));
          }
        } catch (err) {
          if (!signal?.aborted) controller.enqueue(ndjson({ error: `Stream failed: ${describe(err)}` }));
        } finally {
          void recordAnthropicSpend(model, usage);
          controller.close();
        }
      },
      cancel() {
        events.controller.abort();
      },
    });
  }
  throw new Error(describe(lastErr));
}

/**
 * One buffered completion, for background work (resumes, apply packets, the
 * investigation loop's command-picking steps).
 */
export async function completeAnthropic(
  messages: ChatMessage[],
  opts: CallOpts & { models: string[]; timeoutMs?: number }
): Promise<{ text: string; model: string }> {
  const api = anthropic();
  let lastErr: unknown = new Error("no model to try");
  for (const model of opts.models) {
    try {
      const res = await api.messages.create(baseParams(model, messages, opts), {
        timeout: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      });
      void recordAnthropicSpend(res.model, res.usage);
      if (res.stop_reason === "refusal") throw new Error("Claude declined to answer this request.");
      const text = textFromContent(res.content);
      if (!text.trim()) throw new Error("The model returned an empty answer.");
      return { text, model: res.model };
    } catch (err) {
      lastErr = err;
      if (worthTryingNext(err)) {
        console.warn(`[anthropic] ${model} unavailable, trying next:`, describe(err));
        continue;
      }
      throw new Error(describe(err));
    }
  }
  throw new Error(describe(lastErr));
}

/**
 * Model ids the key can use, for the routing form's suggestions. Live rather
 * than hardcoded because the list moves; the static list is the fallback when
 * the request fails, never the first answer.
 */
export function listAnthropicModels(): Promise<string[]> {
  return cached("anthropic:models", MODELS_TTL_MS, async () => {
    if (!isAnthropicConfigured()) return [...ANTHROPIC_MODEL_SUGGESTIONS];
    try {
      const ids: string[] = [];
      for await (const m of anthropic().models.list({ limit: 100 })) ids.push(m.id);
      return ids.length > 0 ? ids : [...ANTHROPIC_MODEL_SUGGESTIONS];
    } catch (err) {
      console.warn("[anthropic] model list failed:", describe(err));
      return [...ANTHROPIC_MODEL_SUGGESTIONS];
    }
  });
}

// ------------------------------------------------------------ spend tally

const SPEND_KEY_PREFIX = "anthropic_spend_";

function spendKey(month: string): string {
  return `${SPEND_KEY_PREFIX}${month}`;
}

/**
 * Adds one response's usage to this month's tally.
 *
 * A read-modify-write on one Setting row. Two replies finishing in the same
 * millisecond could lose one call's tokens; for an estimate shown on the
 * spend page that is acceptable, and the alternative is a table and a
 * migration for a number the Console shows exactly.
 */
async function recordAnthropicSpend(model: string, usage: AnthropicUsage): Promise<void> {
  try {
    const month = spendMonth();
    const key = spendKey(month);
    const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
    const next = addCall(parseMonthSpend(row?.value, month), model, usage);
    const value = JSON.stringify(next);
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch (err) {
    // Billing bookkeeping must never cost the admin the answer.
    console.error("[anthropic] spend tally failed:", err);
  }
}

/** This month's estimated Anthropic spend, or null when the provider is off. */
export async function anthropicMonthSpend(): Promise<AnthropicMonthSpend | null> {
  if (!isAnthropicConfigured()) return null;
  const month = spendMonth();
  try {
    const row = await prisma.setting.findUnique({ where: { key: spendKey(month) }, select: { value: true } });
    return parseMonthSpend(row?.value, month);
  } catch {
    return parseMonthSpend(null, month);
  }
}
