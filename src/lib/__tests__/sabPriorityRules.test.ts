import { describe, expect, it } from "vitest";
import { priorityChanges } from "../sabPriorityRules";

describe("priorityChanges", () => {
  it("raises new content and lowers upgrades", () => {
    const got = priorityChanges(
      [
        { nzoId: "a", priority: "Normal" },
        { nzoId: "b", priority: "Normal" },
      ],
      [
        { downloadId: "a", isUpgrade: true },
        { downloadId: "b", isUpgrade: false },
      ]
    );
    expect(got).toEqual([
      { nzoId: "a", priority: -1 },
      { nzoId: "b", priority: 1 },
    ]);
  });

  it("changes nothing already right", () => {
    expect(
      priorityChanges([{ nzoId: "a", priority: "High" }], [{ downloadId: "a", isUpgrade: false }])
    ).toEqual([]);
  });

  it("treats a season pack as new if any episode in it is new", () => {
    const got = priorityChanges(
      [{ nzoId: "pack", priority: "Normal" }],
      [
        { downloadId: "pack", isUpgrade: true },
        { downloadId: "pack", isUpgrade: false },
      ]
    );
    expect(got).toEqual([{ nzoId: "pack", priority: 1 }]);
  });

  it("leaves forced jobs and jobs Sonarr/Radarr do not own alone", () => {
    expect(
      priorityChanges(
        [
          { nzoId: "forced", priority: "Force" },
          { nzoId: "manual", priority: "Normal" },
        ],
        [{ downloadId: "forced", isUpgrade: true }]
      )
    ).toEqual([]);
  });

  it("matches ids case-insensitively", () => {
    expect(
      priorityChanges([{ nzoId: "ABC", priority: "Normal" }], [{ downloadId: "abc", isUpgrade: false }])
    ).toEqual([{ nzoId: "ABC", priority: 1 }]);
  });
});
