import { describe, expect, it } from "vitest";
import { markShowWatched, takeShowWatched } from "@/lib/showResumeFreshness";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("showResumeFreshness", () => {
  it("reports a watch once, per show", () => {
    const s = memory();
    markShowWatched("2342", s);
    expect(takeShowWatched("1", s)).toBe(false);
    expect(takeShowWatched("2342", s)).toBe(true);
    expect(takeShowWatched("2342", s)).toBe(false);
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => markShowWatched("1", broken)).not.toThrow();
    expect(takeShowWatched("1", broken)).toBe(false);
    expect(takeShowWatched("1", null)).toBe(false);
  });
});
