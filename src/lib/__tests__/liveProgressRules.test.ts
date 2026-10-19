import { describe, expect, it } from "vitest";
import { progressKey, sabPercent, withClientProgress } from "../liveProgressRules";

describe("progress from the download client", () => {
  const client = new Map([
    ["sabnzbd_nzo_abc", 43.2],
    ["0f1e2d3c", 87.6],
  ]);

  it("replaces the *arr figure with the client's for a transfer the client has", () => {
    const rows = [
      { downloadId: "SABnzbd_nzo_abc", progress: 0 },
      { downloadId: "0F1E2D3C", progress: 12 },
    ];
    expect(withClientProgress(rows, client).map((r) => r.progress)).toEqual([43, 88]);
  });

  it("keeps the *arr figure when the client does not know the transfer, or there is no id", () => {
    const rows = [{ downloadId: "gone", progress: 100 }, { progress: 55 }, { downloadId: null, progress: null }];
    expect(withClientProgress(rows, client)).toEqual(rows);
  });

  it("never takes a finished transfer backwards", () => {
    expect(withClientProgress([{ downloadId: "0f1e2d3c", progress: 100 }], client)[0].progress).toBe(100);
  });

  it("returns the same object when nothing changes", () => {
    const row = { downloadId: "0f1e2d3c", progress: 88 };
    expect(withClientProgress([row], client)[0]).toBe(row);
  });

  it("keys ids case-insensitively and reads SABnzbd's string percentages", () => {
    expect(progressKey("  ABC ")).toBe("abc");
    expect(sabPercent("37.5")).toBe(37.5);
    expect(sabPercent(12)).toBe(12);
    expect(sabPercent(undefined)).toBeNull();
    expect(sabPercent("")).toBeNull();
  });
});
