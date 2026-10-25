import { describe, expect, it } from "vitest";
import { clampSize, nudgeSize, parseStoredSize, NUDGE_STEP, NUDGE_STEP_LARGE } from "./paneSizeRules";

describe("clampSize", () => {
  it("keeps sizes inside the range", () => {
    expect(clampSize(100, 180, 520)).toBe(180);
    expect(clampSize(900, 180, 520)).toBe(520);
    expect(clampSize(300.4, 180, 520)).toBe(300);
  });
  it("lets min win when there is no room", () => {
    expect(clampSize(300, 180, 120)).toBe(180);
  });
  it("treats NaN as the minimum", () => {
    expect(clampSize(NaN, 80, 400)).toBe(80);
  });
});

describe("parseStoredSize", () => {
  it("reads a saved size back, clamped to today's range", () => {
    expect(parseStoredSize("300", 180, 520)).toBe(300);
    expect(parseStoredSize("2000", 180, 520)).toBe(520);
    expect(parseStoredSize("20", 180, 520)).toBe(180);
  });
  it("falls back to the default for missing or junk values", () => {
    expect(parseStoredSize(null, 180, 520)).toBeNull();
    expect(parseStoredSize("", 180, 520)).toBeNull();
    expect(parseStoredSize("wide", 180, 520)).toBeNull();
    expect(parseStoredSize("-5", 180, 520)).toBeNull();
    expect(parseStoredSize("0", 180, 520)).toBeNull();
  });
});

describe("nudgeSize", () => {
  const range = { min: 180, max: 520 };
  it("moves a vertical bar with Left/Right", () => {
    expect(nudgeSize(300, "ArrowRight", "vertical", range)).toBe(300 + NUDGE_STEP);
    expect(nudgeSize(300, "ArrowLeft", "vertical", range)).toBe(300 - NUDGE_STEP);
    expect(nudgeSize(300, "ArrowUp", "vertical", range)).toBeNull();
  });
  it("moves a horizontal bar with Up/Down", () => {
    expect(nudgeSize(300, "ArrowDown", "horizontal", range)).toBe(300 + NUDGE_STEP);
    expect(nudgeSize(300, "ArrowUp", "horizontal", range)).toBe(300 - NUDGE_STEP);
    expect(nudgeSize(300, "ArrowLeft", "horizontal", range)).toBeNull();
  });
  it("takes bigger steps with Shift and stops at the ends", () => {
    expect(nudgeSize(300, "ArrowRight", "vertical", { ...range, large: true })).toBe(300 + NUDGE_STEP_LARGE);
    expect(nudgeSize(510, "ArrowRight", "vertical", range)).toBe(520);
    expect(nudgeSize(185, "ArrowLeft", "vertical", range)).toBe(180);
  });
  it("jumps with Home/End", () => {
    expect(nudgeSize(300, "Home", "vertical", range)).toBe(180);
    expect(nudgeSize(300, "End", "vertical", range)).toBe(520);
  });
  it("ignores other keys", () => {
    expect(nudgeSize(300, "Enter", "vertical", range)).toBeNull();
  });
});
