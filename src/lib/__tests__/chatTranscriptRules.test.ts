import { describe, it, expect } from "vitest";
import { createReplyCollector, failureNote, REPLY_LOG_MAX } from "../chatTranscriptRules";

const enc = new TextEncoder();
const line = (content: string) => JSON.stringify({ message: { content }, done: false }) + "\n";

describe("collecting a reply from the stream", () => {
  it("joins the pieces in order", () => {
    const c = createReplyCollector();
    c.push(enc.encode(line("The standby ") + line("exit node ")));
    c.push(enc.encode(line("is down.")));
    expect(c.text()).toBe("The standby exit node is down.");
  });

  it("survives a chunk that splits a line, and a multi-byte character", () => {
    const c = createReplyCollector();
    const bytes = enc.encode(line("café — ok"));
    c.push(bytes.slice(0, 27));
    c.push(bytes.slice(27));
    expect(c.text()).toBe("café — ok");
  });

  it("reads a last line that never got its newline", () => {
    const c = createReplyCollector();
    c.push(enc.encode(line("done").trimEnd()));
    expect(c.text()).toBe("done");
  });

  it("records a stream error after whatever was said", () => {
    const c = createReplyCollector();
    c.push(enc.encode(line("Checking") + JSON.stringify({ error: "HTTP 402: more credits" }) + "\n"));
    expect(c.text()).toBe(`Checking\n${failureNote("HTTP 402: more credits")}`);
  });

  it("ignores lines that are not this format", () => {
    const c = createReplyCollector();
    c.push(enc.encode("not json\n" + JSON.stringify({ done: true }) + "\n" + line("hi")));
    expect(c.text()).toBe("hi");
  });

  it("stops keeping text past the cap", () => {
    const c = createReplyCollector();
    for (let i = 0; i < 30; i++) c.push(enc.encode(line("x".repeat(1000))));
    expect(c.text().length).toBeLessThanOrEqual(REPLY_LOG_MAX);
  });
});
