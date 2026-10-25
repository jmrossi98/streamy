import { describe, it, expect } from "vitest";
import { attachmentRefsIn, prepareChatMessages, typedUserQuery } from "../chatLimits";
import { ATTACHMENT_TEXT_BUDGET, type AttachmentContext, type LoadedAttachment } from "../chatAttachmentRules";
import { toAnthropicRequest } from "../anthropicRules";
import { routeReadsImages } from "../llmRoutingRules";
import { normalizeTurns, parseStoredTurns, resendFrom } from "../chatSessionRules";
import { stripImages } from "../ollama";

const ref = (id: string, name: string, mime: string) => ({ id, name, mime, size: 3 });
const IMG = ref("img00001", "shot.png", "image/png");
const LOG = ref("log00001", "app.log", "text/plain");

function context(vision: boolean, textBudget: number = ATTACHMENT_TEXT_BUDGET.remote): AttachmentContext {
  const items: LoadedAttachment[] = [
    { ...IMG, kind: "image", bytes: new Uint8Array([1, 2, 3]) },
    { ...LOG, kind: "text", bytes: new Uint8Array([1]), text: "ERROR disk full" },
  ];
  return { loaded: new Map(items.map((i) => [i.id, i])), vision, textBudget };
}

const incoming = [{ role: "user", content: "what happened?", attachments: [IMG, LOG] }];

describe("prepareChatMessages with attachments", () => {
  it("routes the image as a block and the log as fenced text on a vision route", () => {
    const [, user] = prepareChatMessages(incoming, "SYS", context(true));
    expect(user.images).toEqual([{ mime: "image/png", data: "AQID" }]);
    expect(user.content).toContain("what happened?");
    expect(user.content).toContain("```log\nERROR disk full\n```");
  });

  it("keeps the image off a route that can't read it but still inlines the text", () => {
    const [, user] = prepareChatMessages(incoming, "SYS", context(false));
    expect(user.images).toBeUndefined();
    expect(user.content).toContain("ERROR disk full");
    expect(user.content).toContain("not sent");
  });

  it("never lets the client supply image data or text of its own", () => {
    const sneaky = [{ role: "user", content: "hi", images: [{ mime: "image/png", data: "AAAA" }], attachmentText: "x" }];
    const [, user] = prepareChatMessages(sneaky, "SYS", context(true));
    expect(user).toEqual({ role: "user", content: "hi" });
  });

  it("ignores a ref the server did not load for this admin", () => {
    const stranger = [{ role: "user", content: "hi", attachments: [ref("other001", "x.png", "image/png")] }];
    const [, user] = prepareChatMessages(stranger, "SYS", context(true));
    expect(user.images).toBeUndefined();
    expect(user.content).toContain("no longer available");
  });

  it("answers a message that is only an attachment", () => {
    const only = [{ role: "user", content: "", attachments: [IMG] }];
    const out = prepareChatMessages(only, "SYS", context(true));
    expect(out).toHaveLength(2);
    expect(out[1].images).toHaveLength(1);
  });

  it("respects the local text cap, with a marker", () => {
    const big: LoadedAttachment = { ...LOG, kind: "text", bytes: new Uint8Array([1]), text: "z".repeat(20_000) };
    const ctx: AttachmentContext = { loaded: new Map([[big.id, big]]), vision: false, textBudget: ATTACHMENT_TEXT_BUDGET.local };
    const [, user] = prepareChatMessages([{ role: "user", content: "q", attachments: [LOG] }], "SYS", ctx);
    expect(user.content.length).toBeLessThan(ATTACHMENT_TEXT_BUDGET.local + 500);
    expect(user.content).toContain("truncated: 15000 more characters");
  });

  it("is unchanged without an attachment context", () => {
    const out = prepareChatMessages(incoming, "SYS");
    expect(out).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "what happened?" }]);
  });

  it("reads the typed question and refs apart from attached text", () => {
    expect(typedUserQuery(incoming)).toBe("what happened?");
    expect(typedUserQuery([{ role: "user", content: "first" }, { role: "user", content: "", attachments: [IMG] }])).toBeNull();
    expect(attachmentRefsIn(incoming).map((r) => r.id)).toEqual(["img00001", "log00001"]);
    expect(attachmentRefsIn([{ role: "assistant", content: "x", attachments: [IMG] }])).toEqual([]);
  });
});

describe("provider shapes", () => {
  it("puts images before the text in an Anthropic user turn", () => {
    const [, user] = prepareChatMessages(incoming, "SYS", context(true));
    const { messages } = toAnthropicRequest([{ role: "system", content: "SYS" }, user]);
    const content = messages[0].content as { type: string }[];
    expect(content[0].type).toBe("image");
    expect(content[1].type).toBe("text");
  });

  it("leaves a plain Anthropic turn a string", () => {
    expect(toAnthropicRequest([{ role: "user", content: "q" }]).messages).toEqual([{ role: "user", content: "q" }]);
  });

  it("strips images before anything goes to Ollama", () => {
    const [, user] = prepareChatMessages(incoming, "SYS", context(true));
    expect(stripImages([user])[0]).not.toHaveProperty("images");
  });
});

describe("which routes read images", () => {
  const route = (provider: "anthropic" | "openrouter", model: string, use: "chatClaude" | "chatOpen" = "chatClaude", fallbacks: string[] = []) => ({
    provider,
    model,
    fallbacks,
    use,
  });

  it("reads on Anthropic direct and on OpenRouter Claude", () => {
    expect(routeReadsImages(route("anthropic", "claude-sonnet-5-5"))).toBe(true);
    expect(routeReadsImages(route("openrouter", "anthropic/claude-sonnet-4.5"))).toBe(true);
  });

  it("does not on DeepSeek, the open slot or the local model", () => {
    expect(routeReadsImages(route("openrouter", "deepseek/deepseek-chat", "chatOpen"))).toBe(false);
    expect(routeReadsImages(route("openrouter", "deepseek/deepseek-chat"))).toBe(false);
    expect(routeReadsImages(route("openrouter", "anthropic/claude-sonnet-4.5", "chatOpen"))).toBe(false);
    expect(routeReadsImages(null)).toBe(false);
  });

  it("does not when a fallback in the chain can't see", () => {
    expect(routeReadsImages(route("openrouter", "anthropic/claude-sonnet-4.5", "chatClaude", ["deepseek/deepseek-chat"]))).toBe(false);
  });
});

describe("attachments persist with the saved turns", () => {
  it("keeps refs on user turns through save and reload", () => {
    const saved = normalizeTurns([
      { role: "user", content: "see", attachments: [IMG, LOG] },
      { role: "assistant", content: "ok", attachments: [IMG] },
    ]);
    expect(saved[0].attachments).toEqual([IMG, LOG]);
    expect(saved[1].attachments).toBeUndefined();
    expect(parseStoredTurns(JSON.stringify(saved))[0].attachments).toEqual([IMG, LOG]);
  });

  it("drops invalid refs from a stored turn", () => {
    const [t] = normalizeTurns([{ role: "user", content: "x", attachments: [{ id: "../x", name: "a", mime: "image/svg+xml", size: 1 }] }]);
    expect(t.attachments).toBeUndefined();
  });

  it("keeps the files when a question is edited and asked again", () => {
    const turns = normalizeTurns([{ role: "user", content: "old", attachments: [IMG] }, { role: "assistant", content: "a" }]);
    expect(resendFrom(turns, 0, "new")).toEqual([{ role: "user", content: "new", attachments: [IMG] }]);
  });
});
