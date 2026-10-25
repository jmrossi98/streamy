/**
 * The shape-shifting between Streamy's one chat message list and Anthropic's
 * Messages API, kept pure so it can be tested without a key.
 *
 * Streamy builds prompts as a flat list where system messages are sprinkled
 * in -- the base prompt first, then context blocks (stack status, docs, vault
 * notes) inserted just before the last user turn, and sometimes an instruction
 * appended at the very end. OpenAI-style endpoints accept that as-is.
 * Anthropic's does not: system text goes in its own top-level field and the
 * message list must be user/assistant turns starting with a user.
 */

import type { ChatMessage } from "./ollama";

export type AnthropicTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export type AnthropicImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string };
};

export type AnthropicTurn = {
  role: "user" | "assistant";
  content: string | (AnthropicImageBlock | { type: "text"; text: string })[];
};

export type AnthropicRequestShape = {
  system: AnthropicTextBlock[] | undefined;
  messages: AnthropicTurn[];
};

function isAnthropicImage(i: { mime: string }): i is { mime: AnthropicImageBlock["source"]["media_type"]; data: string } {
  return i.mime === "image/png" || i.mime === "image/jpeg" || i.mime === "image/webp" || i.mime === "image/gif";
}

/**
 * Splits the flat list into Anthropic's two fields.
 *
 * Every system message becomes a system block, in order, so the per-request
 * context still reaches the model. The *first* one gets a cache breakpoint:
 * it is the fixed base prompt, identical across turns, and the context blocks
 * after it vary per request. Anything shorter than the model's minimum
 * cacheable prefix is silently not cached, which costs nothing.
 *
 * Leading assistant turns are dropped (the API wants a user turn first). The
 * browser never sends one, but the browser is data.
 */
export function toAnthropicRequest(messages: ChatMessage[]): AnthropicRequestShape {
  const system: AnthropicTextBlock[] = [];
  const turns: AnthropicTurn[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (!m.content.trim()) continue;
      system.push({ type: "text", text: m.content });
      continue;
    }
    if (turns.length === 0 && m.role === "assistant") continue;
    const images = m.role === "user" ? (m.images ?? []).filter(isAnthropicImage) : [];
    if (images.length > 0) {
      // Images first, then the words about them, as Anthropic recommends.
      turns.push({
        role: "user",
        content: [
          ...images.map((i): AnthropicImageBlock => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })),
          ...(m.content.trim() ? [{ type: "text" as const, text: m.content }] : []),
        ],
      });
      continue;
    }
    turns.push({ role: m.role, content: m.content });
  }
  if (system.length > 0) system[0] = { ...system[0], cache_control: { type: "ephemeral" } };
  return { system: system.length > 0 ? system : undefined, messages: turns };
}

/**
 * Text from a response's content blocks.
 *
 * With web search on, the answer arrives as several text blocks with tool-use
 * and result blocks between them; the text blocks are one answer in pieces,
 * so they are joined without a separator.
 */
export function textFromContent(blocks: readonly { type: string; text?: string }[]): string {
  let out = "";
  for (const b of blocks) if (b.type === "text" && typeof b.text === "string") out += b.text;
  return out;
}

/**
 * Thinking shares the output ceiling.
 *
 * On the current models reasoning is always on and its tokens count against
 * max_tokens. A 300-token ceiling for "write a few RUN lines" would be spent
 * on thinking before the first visible token, and the reply would come back
 * empty with the tokens billed. So the ceiling the caller asks for is the
 * *visible* budget; this headroom is added for the reasoning.
 */
export const THINKING_HEADROOM = 4096;

export function anthropicMaxTokens(visible: number): number {
  return Math.max(1, Math.floor(visible)) + THINKING_HEADROOM;
}

/**
 * Why an answer came back with no text, for the error the caller shows. The
 * usual cause is the output ceiling spent on reasoning (stop "max_tokens"),
 * which the caller fixes by asking for more; naming it saves a guess.
 */
export function emptyAnswerMessage(stopReason: string | null, outputTokens: number, maxTokens: number): string {
  if (stopReason === "max_tokens") {
    return `The model ran out of output budget before writing an answer (${outputTokens} of ${maxTokens} tokens spent on reasoning). Ask for a larger maxTokens.`;
  }
  return `The model returned an empty answer (stop reason: ${stopReason ?? "none"}, ${outputTokens} output tokens).`;
}

export type Effort = "low" | "medium" | "high";

/**
 * Whether a model accepts output_config.effort. Haiku 4.5 and older models
 * reject it with a 400, and a rejected parameter is a failed turn -- so it is
 * only sent to families known to take it.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/.test(model);
}

/**
 * Which web search tool variant a model takes. The dynamic-filtering variant
 * exists from Opus 4.6 / Sonnet 4.6 onwards; older models (and Haiku) take the
 * basic one. Sending the newer type to a model without it is a 400.
 */
export function webSearchToolFor(model: string): { type: string; name: "web_search"; max_uses: number } {
  const dynamic = /^claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5)|fable|mythos)/.test(model);
  return {
    type: dynamic ? "web_search_20260209" : "web_search_20250305",
    name: "web_search",
    max_uses: 5,
  };
}

export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** $ per million tokens: input, output, cache read, cache write. */
type Price = { in: number; out: number; cacheRead: number; cacheWrite: number };

/**
 * List prices, first-party API, as of 2026-10. Matched by family prefix so a
 * dated snapshot id prices the same as its family. Unknown models price as
 * null and the spend row says so rather than inventing a figure.
 */
const PRICES: [RegExp, Price][] = [
  [/^claude-(fable|mythos)-5/, { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  [/^claude-opus-5-5/, { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }],
  [/^claude-opus-(5|4-[678])/, { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/^claude-sonnet-5/, { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/^claude-sonnet-4-6/, { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/^claude-haiku-5/, { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  [/^claude-haiku-4/, { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
];

/** Estimated cost of one response in USD, or null for a model not in the table. */
export function estimateUsd(model: string, usage: AnthropicUsage): number | null {
  const price = PRICES.find(([re]) => re.test(model))?.[1];
  if (!price) return null;
  const per = (tokens: number | null | undefined, rate: number) => ((tokens ?? 0) / 1_000_000) * rate;
  return (
    per(usage.input_tokens, price.in) +
    per(usage.output_tokens, price.out) +
    per(usage.cache_read_input_tokens, price.cacheRead) +
    per(usage.cache_creation_input_tokens, price.cacheWrite)
  );
}

/** Month-to-date tally, as stored. Tokens are kept so an unpriced model still shows. */
export type AnthropicMonthSpend = {
  month: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum of the per-call estimates for calls whose model was priced. */
  usd: number;
  /** Calls whose model was not in the price table, so `usd` understates. */
  unpricedCalls: number;
};

export function emptyMonthSpend(month: string): AnthropicMonthSpend {
  return {
    month,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usd: 0,
    unpricedCalls: 0,
  };
}

/** YYYY-MM in UTC, the key a tally is stored under. */
export function spendMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function addCall(tally: AnthropicMonthSpend, model: string, usage: AnthropicUsage): AnthropicMonthSpend {
  const usd = estimateUsd(model, usage);
  return {
    ...tally,
    calls: tally.calls + 1,
    inputTokens: tally.inputTokens + usage.input_tokens,
    outputTokens: tally.outputTokens + usage.output_tokens,
    cacheReadTokens: tally.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: tally.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
    usd: tally.usd + (usd ?? 0),
    unpricedCalls: tally.unpricedCalls + (usd === null ? 1 : 0),
  };
}

/** Reads a stored tally, tolerating a missing or malformed row. */
export function parseMonthSpend(raw: string | null | undefined, month: string): AnthropicMonthSpend {
  if (!raw) return emptyMonthSpend(month);
  try {
    const parsed = JSON.parse(raw) as Partial<AnthropicMonthSpend>;
    if (parsed.month !== month) return emptyMonthSpend(month);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      month,
      calls: num(parsed.calls),
      inputTokens: num(parsed.inputTokens),
      outputTokens: num(parsed.outputTokens),
      cacheReadTokens: num(parsed.cacheReadTokens),
      cacheWriteTokens: num(parsed.cacheWriteTokens),
      usd: num(parsed.usd),
      unpricedCalls: num(parsed.unpricedCalls),
    };
  } catch {
    return emptyMonthSpend(month);
  }
}
