import { describe, expect, it } from "vitest";
import { sliceStreamPage, tally } from "../streamSearch";
import type { DispatcharrStream } from "../dispatcharr";

function stream(name: string, provider: string | null = "trex"): DispatcharrStream {
  return {
    id: Math.floor(Math.random() * 1e9),
    name,
    logoUrl: null,
    groupId: null,
    suggestedNumber: null,
    stale: false,
    tvgId: null,
    provider,
  };
}

describe("tally", () => {
  it("counts by value, commonest first", () => {
    expect(tally(["a", "b", "a"])).toEqual([
      { name: "a", count: 2 },
      { name: "b", count: 1 },
    ]);
  });

  it("breaks ties by name so the chips don't shuffle between loads", () => {
    expect(tally(["b", "a"]).map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("ignores missing values rather than counting a blank facet", () => {
    expect(tally([null, undefined, "", "a"])).toEqual([{ name: "a", count: 1 }]);
  });
});

describe("sliceStreamPage", () => {
  // 60 sports streams, so the counts and the page size disagree on purpose.
  const many = [
    ...Array.from({ length: 60 }, (_, i) => stream(`ESPN ${i}`)),
    ...Array.from({ length: 5 }, (_, i) => stream(`Food Network ${i}`, "strong8k")),
  ];

  it("counts categories across everything, not just the page", () => {
    // The bug this replaces: counts were taken from the fifty rows in hand,
    // so "Sports (3)" could sit above four hundred sports streams.
    const page = sliceStreamPage(many, { page: 1, pageSize: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.categories.find((c) => c.name === "Sports")?.count).toBe(60);
  });

  it("keeps every chip visible after one is picked", () => {
    const page = sliceStreamPage(many, { page: 1, pageSize: 50, category: "Sports" });
    expect(page.categories.map((c) => c.name)).toContain("Lifestyle");
  });

  it("filters the whole set, so paging a category pages that category", () => {
    const page = sliceStreamPage(many, { page: 2, pageSize: 50, category: "Sports" });
    expect(page.total).toBe(60);
    expect(page.items).toHaveLength(10);
  });

  it("reports the filtered total, so the page count agrees with the rows", () => {
    const page = sliceStreamPage(many, { page: 1, pageSize: 50, category: "Lifestyle" });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(5);
  });

  it("filters by provider", () => {
    const page = sliceStreamPage(many, { page: 1, pageSize: 50, provider: "strong8k" });
    expect(page.total).toBe(5);
    expect(page.providers).toEqual([
      { name: "trex", count: 60 },
      { name: "strong8k", count: 5 },
    ]);
  });

  it("combines both filters", () => {
    const page = sliceStreamPage(many, {
      page: 1,
      pageSize: 50,
      category: "Sports",
      provider: "strong8k",
    });
    expect(page.total).toBe(0);
  });

  it('treats "all" as no filter', () => {
    const page = sliceStreamPage(many, {
      page: 1,
      pageSize: 100,
      category: "all",
      provider: "all",
    });
    expect(page.total).toBe(65);
  });

  it("returns an empty page past the end rather than throwing", () => {
    const page = sliceStreamPage(many, { page: 99, pageSize: 50 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(65);
  });
});
