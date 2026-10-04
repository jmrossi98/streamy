import { describe, expect, it } from "vitest";
import { compareRecent } from "../gameSortRules";

const lib = (addedAt: string | null) => ({ addedAt, status: "library", jobId: null, wishlistId: null });

describe("compareRecent", () => {
  it("puts downloading, queued and just-finished games above everything dated", () => {
    const rows = [
      { name: "old", ...lib("2026-01-01T00:00:00Z") },
      { name: "downloading", addedAt: null, status: "downloading", jobId: 4, wishlistId: null },
      { name: "new", ...lib("2026-10-01T00:00:00Z") },
      { name: "queued", addedAt: null, status: "queued", jobId: null, wishlistId: 9 },
      { name: "just finished", addedAt: null, status: "library", jobId: 5, wishlistId: null },
      { name: "unknown date", ...lib(null) },
    ];
    const order = [...rows].sort(compareRecent).map((r) => r.name);
    expect(order.slice(0, 3).sort()).toEqual(["downloading", "just finished", "queued"]);
    expect(order.slice(3)).toEqual(["new", "old", "unknown date"]);
  });
});
