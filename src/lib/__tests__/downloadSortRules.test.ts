import { describe, expect, it } from "vitest";
import { sortDownloads, type SortableDownload } from "../downloadSortRules";

const row = (title: string, completed: boolean, addedAt?: string | null) =>
  ({ title, completed, addedAt }) as SortableDownload & { title: string };

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

  it("keeps in-flight rows above finished ones", () => {
    // A searching or transferring row has no added date -- nothing has been
    // added yet -- so ordering it by one would bury the row the viewer is
    // most likely watching under a library's worth of history.
    const rows = [
      row("done", true, "2026-09-01T00:00:00Z"),
      row("downloading", false, null),
    ];
    expect(sortDownloads(rows, "recent").map((r) => r.title)).toEqual([
      "downloading",
      "done",
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
