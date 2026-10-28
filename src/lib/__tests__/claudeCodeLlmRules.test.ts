import { describe, it, expect } from "vitest";
import { askChange, failureReason, parseAskLine, renderChatPrompt, replyDelta } from "../claudeCodeLlmRules";
import type { ChatMessage } from "../ollama";

const png = { mime: "image/png", data: "aGVsbG8=" };

describe("renderChatPrompt", () => {
  it("puts context first, then the turns, latest question last", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are the assistant." },
      { role: "user", content: "first?" },
      { role: "assistant", content: "first answer" },
      { role: "system", content: "STATUS: all green" },
      { role: "user", content: "second?" },
    ];
    const { prompt, images } = renderChatPrompt(messages);
    expect(images).toEqual([]);
    expect(prompt.indexOf("# Context")).toBe(0);
    expect(prompt).toContain("You are the assistant.");
    expect(prompt.indexOf("STATUS: all green")).toBeLessThan(prompt.indexOf("# Conversation"));
    expect(prompt).toContain("Jake: first?\n\nAssistant: first answer\n\nJake: second?");
    expect(prompt.endsWith("Jake: second?")).toBe(true);
  });

  it("sends images from the last user message only", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "old", images: [png] },
      { role: "assistant", content: "seen" },
      {
        role: "user",
        content: "new",
        images: [png, { mime: "image/jpeg", data: "aGk=" }, { mime: "application/pdf", data: "eA==" }],
      },
    ];
    const { prompt, images } = renderChatPrompt(messages);
    expect(images.map((i) => i.mime)).toEqual(["image/png", "image/jpeg"]);
    expect(prompt).toContain("Jake: new\n[2 images attached]");
    expect(prompt).not.toContain("Jake: old\n[");
  });

  it("caps images at six", () => {
    const { images } = renderChatPrompt([{ role: "user", content: "x", images: Array(9).fill(png) }]);
    expect(images).toHaveLength(6);
  });

  it("drops the oldest turns to fit, never the latest question", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: "user", content: `q${i} ${"x".repeat(100)}` });
      messages.push({ role: "assistant", content: `a${i} ${"y".repeat(100)}` });
    }
    messages.push({ role: "user", content: "latest" });
    const { prompt } = renderChatPrompt(messages, 1000);
    expect(prompt.length).toBeLessThanOrEqual(1000);
    expect(prompt.endsWith("Jake: latest")).toBe(true);
    expect(prompt).toContain("Earlier turns of this conversation were left out");
    expect(prompt).not.toContain("q0 ");
  });

  it("cuts oversized context before the conversation", () => {
    const { prompt } = renderChatPrompt(
      [
        { role: "system", content: "c".repeat(5000) },
        { role: "user", content: "hello" },
      ],
      1000
    );
    expect(prompt.length).toBeLessThanOrEqual(1000);
    expect(prompt.endsWith("Jake: hello")).toBe(true);
  });
});

describe("replyDelta", () => {
  it("sends the new suffix", () => {
    expect(replyDelta("", "Hel")).toEqual({ delta: "Hel", sent: "Hel" });
    expect(replyDelta("Hel", "Hello")).toEqual({ delta: "lo", sent: "Hello" });
    expect(replyDelta("Hello", "Hello")).toEqual({ delta: "", sent: "Hello" });
  });

  it("sends only what follows the common prefix when the text was rewritten", () => {
    expect(replyDelta("Hello wor", "Hello there")).toEqual({ delta: "there", sent: "Hello there" });
  });
});

describe("askChange", () => {
  const ask = { id: "p1", permission: "bash", detail: "docker restart x", since: "t", patterns: ["docker restart *"] };

  it("announces a new question once", () => {
    expect(askChange("run1", null, ask)).toEqual({ ask: { runId: "run1", ...ask } });
    expect(askChange("run1", "p1", ask)).toBeNull();
  });

  it("replaces a question with the next one, and clears it", () => {
    expect(askChange("run1", "p1", { ...ask, id: "p2" })?.ask?.id).toBe("p2");
    expect(askChange("run1", "p1", null)).toEqual({ ask: null });
    expect(askChange("run1", null, null)).toBeNull();
  });
});

describe("parseAskLine", () => {
  it("reads ask lines and ignores everything else", () => {
    expect(parseAskLine({ ask: null })).toBeNull();
    expect(parseAskLine({ ask: { runId: "r1", id: "p1", permission: "bash", detail: "ls", patterns: [] } })).toMatchObject({
      runId: "r1",
      id: "p1",
    });
    expect(parseAskLine({ message: { content: "hi" } })).toBeUndefined();
    expect(parseAskLine({ ask: { runId: "../x", id: "p1" } })).toBeUndefined();
  });
});

describe("failureReason", () => {
  it("names timeouts and cancels plainly", () => {
    expect(failureReason({ status: "timeout", summary: null, output: "" })).toMatch(/out of time/);
    expect(failureReason({ status: "cancelled", summary: null, output: "" })).toMatch(/cancelled/);
  });

  it("uses the summary, else the output's tail", () => {
    expect(failureReason({ status: "failed", summary: "Not logged in", output: "" })).toBe("Claude Code failed: Not logged in");
    expect(failureReason({ status: "failed", summary: null, output: "a\nb\n\nc\nd\n" })).toBe("Claude Code failed: b c d");
    expect(failureReason({ status: "failed", summary: null, output: "" })).toMatch(/without saying why/);
  });
});
