import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  maxOutputTokens,
  modelChain,
  openRouterModel,
  parseSseLine,
} from "../openrouter";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_OPEN_MODEL } from "../chatModels";

// The SSE shape is the fiddly part of this integration and the failure mode is
// silent: a parser that drops every delta shows an empty panel while the
// tokens are billed regardless.

describe("parseSseLine", () => {
  it("extracts the delta text from a content chunk", () => {
    const line = `data: ${JSON.stringify({
      choices: [{ delta: { content: "Hello" } }],
    })}`;
    expect(parseSseLine(line)).toEqual({ kind: "content", text: "Hello" });
  });

  it("recognises the terminating sentinel", () => {
    expect(parseSseLine("data: [DONE]")).toEqual({ kind: "done" });
  });

  // OpenRouter sends these purely to hold the connection open. Treated as data
  // they would render as noise in the transcript.
  it("ignores SSE keep-alive comments", () => {
    expect(parseSseLine(": OPENROUTER PROCESSING")).toEqual({ kind: "ignore" });
    expect(parseSseLine(":")).toEqual({ kind: "ignore" });
  });

  // The stream ends with a usage-only chunk carrying no delta. Emitting it as
  // content would append an empty string; treating it as an error would fail a
  // reply that actually succeeded.
  it("ignores the trailing usage chunk and empty deltas", () => {
    expect(
      parseSseLine(`data: ${JSON.stringify({ choices: [], usage: { total_tokens: 10 } })}`)
    ).toEqual({ kind: "ignore" });
    expect(
      parseSseLine(`data: ${JSON.stringify({ choices: [{ delta: {} }] })}`)
    ).toEqual({ kind: "ignore" });
    expect(
      parseSseLine(`data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}`)
    ).toEqual({ kind: "ignore" });
    expect(
      parseSseLine(`data: ${JSON.stringify({ choices: [{ delta: { content: null } }] })}`)
    ).toEqual({ kind: "ignore" });
  });

  it("ignores blank lines and non-data fields", () => {
    expect(parseSseLine("")).toEqual({ kind: "ignore" });
    expect(parseSseLine("   ")).toEqual({ kind: "ignore" });
    expect(parseSseLine("event: message")).toEqual({ kind: "ignore" });
    expect(parseSseLine("id: 42")).toEqual({ kind: "ignore" });
  });

  // A half-received line is normal mid-stream; killing a paid-for reply over
  // one would be worse than skipping it.
  it("ignores malformed JSON rather than throwing", () => {
    expect(() => parseSseLine("data: {not json")).not.toThrow();
    expect(parseSseLine("data: {not json")).toEqual({ kind: "ignore" });
  });

  it("preserves whitespace inside the delta", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "  two words " } }] })}`;
    expect(parseSseLine(line)).toEqual({ kind: "content", text: "  two words " });
  });
});

describe("openRouterModel", () => {
  const originalOpen = process.env.OPENROUTER_OPEN_MODEL;
  const originalClaude = process.env.OPENROUTER_CLAUDE_MODEL;

  afterEach(() => {
    for (const [key, value] of [
      ["OPENROUTER_OPEN_MODEL", originalOpen],
      ["OPENROUTER_CLAUDE_MODEL", originalClaude],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults each remote backend to its pinned model", () => {
    delete process.env.OPENROUTER_OPEN_MODEL;
    delete process.env.OPENROUTER_CLAUDE_MODEL;
    expect(openRouterModel("open")).toBe(DEFAULT_OPEN_MODEL);
    expect(openRouterModel("claude")).toBe(DEFAULT_CLAUDE_MODEL);
  });

  // OpenRouter's catalogue moves faster than this repo deploys, so a retired
  // model id has to be fixable by swapping a secret.
  it("lets env override either model", () => {
    process.env.OPENROUTER_OPEN_MODEL = "meta-llama/llama-4";
    process.env.OPENROUTER_CLAUDE_MODEL = "anthropic/claude-opus-5";
    expect(openRouterModel("open")).toBe("meta-llama/llama-4");
    expect(openRouterModel("claude")).toBe("anthropic/claude-opus-5");
  });

  it("ignores an empty override rather than sending an empty model id", () => {
    process.env.OPENROUTER_OPEN_MODEL = "";
    expect(openRouterModel("open")).toBe(DEFAULT_OPEN_MODEL);
  });

  // The picker only ever sends "open" or "claude" here, but a local id must
  // not silently resolve to the expensive one.
  it("treats any non-claude backend as the open model", () => {
    delete process.env.OPENROUTER_OPEN_MODEL;
    expect(openRouterModel("local")).toBe(DEFAULT_OPEN_MODEL);
  });
});

describe("maxOutputTokens", () => {
  const original = process.env.OPENROUTER_MAX_TOKENS;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENROUTER_MAX_TOKENS;
    else process.env.OPENROUTER_MAX_TOKENS = original;
  });

  // Omitting max_tokens makes OpenRouter reserve the model's FULL output
  // ceiling against the balance up front -- an instant 402 on a small balance
  // ("requested up to 65536 tokens, but can only afford 2627") no matter how
  // short the answer would have been. A bounded default is the fix.
  it("defaults to a bounded ceiling, not the model's maximum", () => {
    delete process.env.OPENROUTER_MAX_TOKENS;
    expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(maxOutputTokens()).toBeLessThan(65536);
  });

  it("honours a valid override", () => {
    process.env.OPENROUTER_MAX_TOKENS = "512";
    expect(maxOutputTokens()).toBe(512);
  });

  it("ignores junk rather than sending an invalid ceiling", () => {
    for (const junk of ["", "abc", "0", "-100", "NaN"]) {
      process.env.OPENROUTER_MAX_TOKENS = junk;
      expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    }
  });

  it("floors a fractional override", () => {
    process.env.OPENROUTER_MAX_TOKENS = "1024.9";
    expect(maxOutputTokens()).toBe(1024);
  });
});

describe("modelChain", () => {
  const keys = [
    "OPENROUTER_OPEN_MODEL",
    "OPENROUTER_CLAUDE_MODEL",
    "OPENROUTER_OPEN_FALLBACKS",
    "OPENROUTER_CLAUDE_FALLBACKS",
  ] as const;
  const originals = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      const v = originals[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("puts the chosen model at the head of the chain", () => {
    delete process.env.OPENROUTER_OPEN_MODEL;
    delete process.env.OPENROUTER_OPEN_FALLBACKS;
    expect(modelChain("open")[0]).toBe(DEFAULT_OPEN_MODEL);
    expect(modelChain("claude")[0]).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("appends env-configured fallbacks in order", () => {
    process.env.OPENROUTER_OPEN_FALLBACKS = "vendor/a, vendor/b";
    expect(modelChain("open")).toEqual([DEFAULT_OPEN_MODEL, "vendor/a", "vendor/b"]);
  });

  it("ignores blank entries and stray whitespace", () => {
    process.env.OPENROUTER_OPEN_FALLBACKS = " , vendor/a ,, ";
    expect(modelChain("open")).toEqual([DEFAULT_OPEN_MODEL, "vendor/a"]);
  });

  // Retrying the model that just failed is guaranteed to fail identically on a
  // 402, and wastes a slot in the chain.
  it("de-duplicates a fallback that repeats the head", () => {
    process.env.OPENROUTER_OPEN_MODEL = "vendor/a";
    process.env.OPENROUTER_OPEN_FALLBACKS = "vendor/a,vendor/b";
    expect(modelChain("open")).toEqual(["vendor/a", "vendor/b"]);
  });

  // Falling from Claude to a cheap open model would answer the question with
  // the model the admin deliberately escalated away from, while the panel
  // still displayed "Claude".
  it("keeps the Claude chain within the Claude family by default", () => {
    delete process.env.OPENROUTER_CLAUDE_MODEL;
    delete process.env.OPENROUTER_CLAUDE_FALLBACKS;
    for (const model of modelChain("claude")) {
      expect(model.startsWith("anthropic/")).toBe(true);
    }
  });

  it("leaves the open chain to the primary alone unless configured", () => {
    delete process.env.OPENROUTER_OPEN_MODEL;
    delete process.env.OPENROUTER_OPEN_FALLBACKS;
    expect(modelChain("open")).toEqual([DEFAULT_OPEN_MODEL]);
  });

  it("allows an explicit empty override to clear the Claude chain", () => {
    process.env.OPENROUTER_CLAUDE_FALLBACKS = "";
    expect(modelChain("claude")).toEqual([DEFAULT_CLAUDE_MODEL]);
  });
});
