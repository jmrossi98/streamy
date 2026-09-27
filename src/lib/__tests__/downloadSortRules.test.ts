import { describe, expect, it } from "vitest";
import { sortDownloads, type SortableDownload } from "../downloadSortRules";

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

  it("sorts a row with no timestamp last rather than dropping it", () => {
    const rows = [
      started("undated", false, null),
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
