import { describe, it, expect } from "vitest";
import { cueLine, CUE_ROWS_BELOW } from "../subtitleCueRules";

describe("where a subtitle sits", () => {
  it("keeps the last row of every cue on the same row", () => {
    const bottomRow = (text: string) => cueLine(text) + text.split("\n").length - 1;
    expect(bottomRow("one")).toBe(bottomRow("- one\n- two"));
    expect(bottomRow("one")).toBe(bottomRow("a\nb\nc"));
    expect(bottomRow("one")).toBe(-(CUE_ROWS_BELOW + 1));
  });

  it("starts a two-line cue two rows higher than the space it leaves", () => {
    expect(cueLine("- I was a drum major.\n- What is that?")).toBe(-4);
  });

  it("does not count blank rows, and treats an empty cue as one row", () => {
    expect(cueLine("one\n\n")).toBe(cueLine("one"));
    expect(cueLine("")).toBe(cueLine("one"));
  });
});
