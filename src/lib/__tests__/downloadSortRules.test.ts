import { describe, expect, it } from "vitest";
import { dedupeDownloads, sortDownloads, type SortableDownload } from "../downloadSortRules";

const row = (title: string, completed: boolean, addedAt?: string | null) =>
  ({ title, completed, addedAt }) as SortableDownload & { title: string };

/** A row carrying the unified startedAt the panel now sorts on. */
const started = (title: string, completed: boolean, startedAt?: string | null) =>
  ({ title, completed, startedAt }) as SortableDownload & { title: string };

describe("sortDownloads", () => {
  it("leaves the order untouched for the status sort", () => {
    const rows = [row("a", true, "2026-01-01"), row("b", true, "2026-09-01")];
    expect(sortDownloads(rows, "status")).toBe(rows);
  });

  it("puts the most recently added first", () => {
    const rows = [
      row("old", true, "2026-01-01T00:00:00Z"),
      row("new", true, "2026-09-01T00:00:00Z"),
      row("middle", true, "2026-05-01T00:00:00Z"),
    ];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "new",
      "middle",
      "old",
    ]);
  });

  it("puts a just-requested row above an older finished one", () => {
    // The reason to open this panel is almost always "did the thing I just
    // asked for start". A queued row carries the moment it was asked for, so
    // newest-first puts it on top without needing a special case.
    const rows = [
      started("done", true, "2026-09-01T00:00:00Z"),
      started("just queued", false, "2026-09-27T12:00:00Z"),
    ];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "just queued",
      "done",
    ]);
  });

  it("sorts a finished file with no timestamp last rather than dropping it", () => {
    const rows = [
      started("undated", true, null),
      started("dated", true, "2026-09-01T00:00:00Z"),
    ];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "dated",
      "undated",
    ]);
  });

  it("prefers startedAt over addedAt when both are present", () => {
    const rows = [
      { title: "older start", completed: true, startedAt: "2026-01-01T00:00:00Z", addedAt: "2026-12-01T00:00:00Z" },
      { title: "newer start", completed: true, startedAt: "2026-06-01T00:00:00Z", addedAt: "2026-02-01T00:00:00Z" },
    ] as (SortableDownload & { title: string })[];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "newer start",
      "older start",
    ]);
  });

  it("preserves the incoming order among in-flight rows", () => {
    const rows = [row("first", false), row("second", false), row("third", false)];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("sorts a completed row with no date last rather than dropping it", () => {
    const rows = [row("undated", true, null), row("dated", true, "2026-09-01T00:00:00Z")];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "dated",
      "undated",
    ]);
  });

  it("treats an unparseable date as undated", () => {
    const rows = [row("bad", true, "not a date"), row("good", true, "2026-09-01T00:00:00Z")];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual(["good", "bad"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [row("old", true, "2026-01-01"), row("new", true, "2026-09-01")];
    sortDownloads(rows, "recent");
    expect(rows.map((r) => r.title)).toEqual(["old", "new"]);
  });
});

describe("dedupeDownloads", () => {
  type R = { key: string; label: string; completed: boolean; queued?: boolean; searching?: boolean };
  const keyOf = (r: R) => r.key;

  it("keeps one row per key", () => {
    const rows: R[] = [
      { key: "ep-1", label: "queued", completed: false, queued: true },
      { key: "ep-1", label: "done", completed: true },
      { key: "ep-2", label: "other", completed: false },
    ];
    expect(dedupeDownloads(rows, keyOf).map((r) => r.key)).toEqual(["ep-1", "ep-2"]);
  });

  it("prefers an active transfer over a finished file (an upgrade in progress)", () => {
    const rows: R[] = [
      { key: "ep-1", label: "done", completed: true },
      { key: "ep-1", label: "active", completed: false },
    ];
    expect(dedupeDownloads(rows, keyOf)[0].label).toBe("active");
  });

  it("prefers a finished file over a stale queued search", () => {
    const rows: R[] = [
      { key: "ep-1", label: "queued", completed: false, queued: true },
      { key: "ep-1", label: "done", completed: true },
    ];
    expect(dedupeDownloads(rows, keyOf)[0].label).toBe("done");
  });

  it("prefers searching over merely queued", () => {
    const rows: R[] = [
      { key: "ep-1", label: "queued", completed: false, queued: true },
      { key: "ep-1", label: "searching", completed: false, searching: true },
    ];
    expect(dedupeDownloads(rows, keyOf)[0].label).toBe("searching");
  });

  it("collapses all three sources for one episode into the active one", () => {
    // The live case: queued search + download-client entry + file on disk.
    const rows: R[] = [
      { key: "ep-9", label: "queued", completed: false, queued: true },
      { key: "ep-9", label: "done", completed: true },
      { key: "ep-9", label: "active", completed: false },
    ];
    const out = dedupeDownloads(rows, keyOf);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("active");
  });

  it("preserves first-seen order of keys", () => {
    const rows: R[] = [
      { key: "b", label: "b", completed: true },
      { key: "a", label: "a", completed: true },
      { key: "b", label: "b2", completed: false },
    ];
    expect(dedupeDownloads(rows, keyOf).map((r) => r.key)).toEqual(["b", "a"]);
  });
});

describe("sortDownloads by name", () => {
  const named = (title: string) => ({ title, completed: true }) as SortableDownload & { title: string };

  it("sorts alphabetically, ignoring case", () => {
    const rows = [named("zebra"), named("Apple"), named("mango")];
    expect(sortDownloads(rows, "name").map((r) => r.title)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("puts episode 10 after episode 9", () => {
    // Plain string order would put "E10" before "E9".
    const rows = [named("Show - S2 E10"), named("Show - S2 E9"), named("Show - S2 E1")];
    expect(sortDownloads(rows, "name").map((r) => r.title)).toEqual([
      "Show - S2 E1",
      "Show - S2 E9",
      "Show - S2 E10",
    ]);
  });
});

describe("sortDownloads: in-flight rows with no date", () => {
  it("puts an undated download in progress above the whole library", () => {
    // Reported 2026-10-04: Monster House at 50% sat under every finished file.
    const rows = [
      { title: "old file", completed: true, startedAt: "2026-08-30T00:00:00Z" },
      { title: "in progress", completed: false, startedAt: null },
      { title: "new file", completed: true, startedAt: "2026-10-03T00:00:00Z" },
      { title: "undated file", completed: true, startedAt: null },
      { title: "also in progress", completed: false, startedAt: null },
    ];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "in progress",
      "also in progress",
      "new file",
      "old file",
      "undated file",
    ]);
  });
});
