import { describe, expect, it, vi } from "vitest";
import { notePreempted, takePreempted } from "../presenceClient";

describe("notePreempted / takePreempted", () => {
  it("says a player was moved on by the page, once", () => {
    notePreempted("Live: NHL SAN JOSE SHARKS");
    expect(takePreempted("Live: NHL SAN JOSE SHARKS")).toBe(true);
    expect(takePreempted("Live: NHL SAN JOSE SHARKS")).toBe(false);
    expect(takePreempted("Live: ESPN")).toBe(false);
  });

  it("forgets a note too old to belong to this stop", () => {
    vi.useFakeTimers();
    try {
      notePreempted("Live: KICU");
      vi.advanceTimersByTime(11_000);
      expect(takePreempted("Live: KICU")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
