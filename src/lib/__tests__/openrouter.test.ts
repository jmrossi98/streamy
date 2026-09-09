import { describe, it, expect, afterEach } from "vitest";
import { openRouterModel, parseSseLine } from "../openrouter";
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
