import { describe, it, expect } from "vitest";
import { HISTORY_IDLE, shouldIntercept, stepHistory, userMessages } from "../composerHistory";

const msgs = ["first", "second", "third"];

describe("userMessages", () => {
  it("keeps user turns in order and drops assistant and blank ones", () => {
    expect(
      userMessages([
        { role: "user", content: "a" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "  " },
        { role: "user", content: "b" },
      ])
    ).toEqual(["a", "b"]);
  });
});

describe("stepHistory", () => {
  it("steps back newest first, then further back", () => {
    const a = stepHistory(HISTORY_IDLE, "up", msgs, "")!;
    expect(a.text).toBe("third");
    const b = stepHistory(a.pos, "up", msgs, a.text)!;
    expect(b.text).toBe("second");
    const c = stepHistory(b.pos, "up", msgs, b.text)!;
    expect(c.text).toBe("first");
    expect(stepHistory(c.pos, "up", msgs, c.text)).toBeNull();
  });

  it("steps forward and restores the draft past the newest", () => {
    const a = stepHistory(HISTORY_IDLE, "up", msgs, "half typed")!;
    const b = stepHistory(a.pos, "up", msgs, a.text)!;
    const fwd = stepHistory(b.pos, "down", msgs, b.text)!;
    expect(fwd.text).toBe("third");
    const end = stepHistory(fwd.pos, "down", msgs, fwd.text)!;
    expect(end.text).toBe("half typed");
    expect(end.pos).toEqual(HISTORY_IDLE);
  });

  it("keeps the first draft, not a recalled message, across steps", () => {
    const a = stepHistory(HISTORY_IDLE, "up", msgs, "draft")!;
    const b = stepHistory(a.pos, "up", msgs, "edited recalled text")!;
    expect(b.pos.draft).toBe("draft");
  });

  it("does nothing with empty history", () => {
    expect(stepHistory(HISTORY_IDLE, "up", [], "x")).toBeNull();
    expect(stepHistory(HISTORY_IDLE, "down", [], "x")).toBeNull();
  });

  it("ignores ArrowDown when not cycling", () => {
    expect(stepHistory(HISTORY_IDLE, "down", msgs, "x")).toBeNull();
  });
});

describe("shouldIntercept", () => {
  it("takes ArrowUp on an empty box", () => {
    expect(shouldIntercept("up", "", 0, 0)).toBe(true);
  });
  it("takes ArrowUp only with the caret on the first line", () => {
    expect(shouldIntercept("up", "one\ntwo", 2, 2)).toBe(true);
    expect(shouldIntercept("up", "one\ntwo", 5, 5)).toBe(false);
  });
  it("takes ArrowDown only with the caret on the last line", () => {
    expect(shouldIntercept("down", "one\ntwo", 5, 5)).toBe(true);
    expect(shouldIntercept("down", "one\ntwo", 2, 2)).toBe(false);
  });
  it("leaves a selection alone", () => {
    expect(shouldIntercept("up", "abc", 0, 2)).toBe(false);
    expect(shouldIntercept("down", "abc", 1, 3)).toBe(false);
  });
});
