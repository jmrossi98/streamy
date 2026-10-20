import { describe, it, expect } from "vitest";
import {
  THINKING_HEADROOM,
  addCall,
  anthropicMaxTokens,
  emptyMonthSpend,
  estimateUsd,
  parseMonthSpend,
  supportsEffort,
  textFromContent,
  toAnthropicRequest,
  webSearchToolFor,
} from "../anthropicRules";

describe("toAnthropicRequest", () => {
  // Streamy's prompt builder sprinkles system messages through the list;
  // Anthropic wants them in one field, in order, with the turns left alone.
  it("lifts every system message into the system field, in order", () => {
    const { system, messages } = toAnthropicRequest([
      { role: "system", content: "base" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "system", content: "status block" },
      { role: "system", content: "docs block" },
      { role: "user", content: "q2" },
    ]);
    expect(system?.map((b) => b.text)).toEqual(["base", "status block", "docs block"]);
    expect(messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
  });

  // The base prompt is the fixed part; the context after it changes per turn.
  it("puts the cache breakpoint on the first system block only", () => {
    const { system } = toAnthropicRequest([
      { role: "system", content: "base" },
      { role: "system", content: "varies" },
      { role: "user", content: "q" },
    ]);
    expect(system?.[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system?.[1].cache_control).toBeUndefined();
  });

  it("omits the system field when there is none", () => {
    expect(toAnthropicRequest([{ role: "user", content: "q" }]).system).toBeUndefined();
  });

  it("drops leading assistant turns", () => {
    const { messages } = toAnthropicRequest([
      { role: "assistant", content: "stale" },
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
      { role: "user", content: "q2" },
    ]);
    expect(messages[0]).toEqual({ role: "user", content: "q" });
    expect(messages).toHaveLength(3);
  });

  it("skips blank system messages", () => {
    expect(toAnthropicRequest([{ role: "system", content: "  " }, { role: "user", content: "q" }]).system).toBeUndefined();
  });
});

describe("textFromContent", () => {
  // With web search the answer is several text blocks with tool blocks between.
  it("joins text blocks and ignores the rest", () => {
    expect(
      textFromContent([
        { type: "text", text: "Hello " },
        { type: "server_tool_use" },
        { type: "web_search_tool_result" },
        { type: "text", text: "world" },
      ])
    ).toBe("Hello world");
  });
  it("is empty for no text", () => {
    expect(textFromContent([{ type: "tool_use" }])).toBe("");
  });
});

describe("anthropicMaxTokens", () => {
  // The caller's ceiling is for visible text; thinking is billed on top and
  // would otherwise eat a small ceiling before the first visible token.
  it("adds the thinking headroom", () => {
    expect(anthropicMaxTokens(300)).toBe(300 + THINKING_HEADROOM);
    expect(anthropicMaxTokens(0)).toBe(1 + THINKING_HEADROOM);
  });
});

describe("supportsEffort", () => {
  it("knows which families take output_config.effort", () => {
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-4-6", "claude-opus-4-6", "claude-fable-5-1"]) {
      expect(supportsEffort(m)).toBe(true);
    }
    for (const m of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-3-5-sonnet-latest"]) {
      expect(supportsEffort(m)).toBe(false);
    }
  });
});

describe("webSearchToolFor", () => {
  it("uses the dynamic-filtering variant from Opus/Sonnet 4.6 onwards", () => {
    expect(webSearchToolFor("claude-opus-5-5").type).toBe("web_search_20260209");
    expect(webSearchToolFor("claude-sonnet-4-6").type).toBe("web_search_20260209");
  });
  it("uses the basic variant for Haiku and older models", () => {
    expect(webSearchToolFor("claude-haiku-5-5").type).toBe("web_search_20250305");
    expect(webSearchToolFor("claude-sonnet-4-5").type).toBe("web_search_20250305");
  });
});

describe("estimateUsd", () => {
  it("prices a known model from list rates", () => {
    const usd = estimateUsd("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    expect(usd).toBeCloseTo(4 + 20 + 0.2, 6);
  });
  it("treats missing cache figures as zero", () => {
    expect(estimateUsd("claude-sonnet-5-5", { input_tokens: 500_000, output_tokens: 0 })).toBeCloseTo(1, 6);
  });
  it("is null for an unknown model rather than a guess", () => {
    expect(estimateUsd("claude-mystery-9", { input_tokens: 10, output_tokens: 10 })).toBeNull();
  });
});

describe("month tally", () => {
  it("accumulates calls and flags the unpriced ones", () => {
    let t = emptyMonthSpend("2026-10");
    t = addCall(t, "claude-opus-5-5", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 50 });
    t = addCall(t, "claude-mystery-9", { input_tokens: 10, output_tokens: 10 });
    expect(t.calls).toBe(2);
    expect(t.inputTokens).toBe(1010);
    expect(t.outputTokens).toBe(110);
    expect(t.cacheReadTokens).toBe(50);
    expect(t.unpricedCalls).toBe(1);
    expect(t.usd).toBeGreaterThan(0);
  });

  it("round-trips through JSON and starts fresh on a new month", () => {
    const t = addCall(emptyMonthSpend("2026-10"), "claude-opus-5-5", { input_tokens: 1, output_tokens: 1 });
    expect(parseMonthSpend(JSON.stringify(t), "2026-10")).toEqual(t);
    expect(parseMonthSpend(JSON.stringify(t), "2026-11")).toEqual(emptyMonthSpend("2026-11"));
    expect(parseMonthSpend("{not json", "2026-10")).toEqual(emptyMonthSpend("2026-10"));
    expect(parseMonthSpend(null, "2026-10")).toEqual(emptyMonthSpend("2026-10"));
  });
});
