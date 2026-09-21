import { describe, expect, it } from "vitest";
import { cleanText, normalizeDashes } from "../text";

describe("normalizeDashes", () => {
  it("keeps the spacing a separator dash had", () => {
    expect(normalizeDashes("NHL Hockey — Sharks at Bruins")).toBe(
      "NHL Hockey - Sharks at Bruins"
    );
  });

  it("keeps a range tight", () => {
    // The distinction that matters: " — " separates, "—" spans. Collapsing
    // both to the same thing gets one of them wrong.
    expect(normalizeDashes("2024—25 season")).toBe("2024-25 season");
  });

  it("handles en dashes and the minus lookalikes the same way", () => {
    expect(normalizeDashes("ESPN – Live")).toBe("ESPN - Live");
    expect(normalizeDashes("7−9 PM")).toBe("7-9 PM");
  });

  it("leaves an ordinary hyphen alone", () => {
    expect(normalizeDashes("Sky Sports Main-Event")).toBe("Sky Sports Main-Event");
  });
});

describe("cleanText", () => {
  it("answers empty for nothing, so callers don't need a guard", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
    expect(cleanText("")).toBe("");
  });

  it("flattens smart quotes and ellipses", () => {
    expect(cleanText("It’s the “big” one…")).toBe(`It's the "big" one...`);
  });

  it("collapses the whitespace providers pad names with", () => {
    expect(cleanText("  USA   Network \n")).toBe("USA Network");
  });

  it("does the whole pass on a real-looking channel name", () => {
    expect(cleanText("US| ESPN+   —  NHL: SJS vs BOS ")).toBe(
      "US| ESPN+ - NHL: SJS vs BOS"
    );
  });
});
