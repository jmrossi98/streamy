import { describe, expect, it } from "vitest";
import { retryIndex } from "./retryRules";

const user = (content: string) => ({ role: "user" as const, content });
const bot = (content: string) => ({ role: "assistant" as const, content });
const runResult = (content = "run") => ({ role: "user" as const, content, via: "skill-run" as const });

describe("retryIndex", () => {
  it("is -1 for an empty chat", () => {
    expect(retryIndex([])).toBe(-1);
  });
  it("points at a last user message nobody answered", () => {
    expect(retryIndex([user("a"), bot("b"), user("c")])).toBe(2);
  });
  it("is -1 once the latest user message has a reply", () => {
    expect(retryIndex([user("a"), bot("b")])).toBe(-1);
  });
  it("is not fooled by an empty assistant turn", () => {
    expect(retryIndex([user("a"), bot(""), bot("  ")])).toBe(0);
  });
  it("does not count a skill-run result as a reply", () => {
    expect(retryIndex([user("a"), runResult()])).toBe(0);
  });
  it("never picks a skill-run result as the message to retry", () => {
    expect(retryIndex([user("a"), bot("b"), runResult()])).toBe(-1);
  });
  it("only looks at the latest user message", () => {
    expect(retryIndex([user("a"), user("b"), bot("c")])).toBe(-1);
    expect(retryIndex([user("a"), bot("b"), user("c"), runResult()])).toBe(2);
  });
  it("counts a reply that came after the skill run", () => {
    expect(retryIndex([user("a"), runResult(), bot("b")])).toBe(-1);
  });
});
