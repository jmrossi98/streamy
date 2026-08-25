import { describe, it, expect } from "vitest";
import { computeProgress } from "../radarr";

describe("computeProgress", () => {
  // Regression: entries whose metadata hasn't resolved report size 0. These
  // were first filtered out entirely (downloads silently vanished from the
  // admin panel), then reported as 0%, which reads as "transfer started"
  // when nothing has. Null is the honest answer and renders as "Starting…".
  it("returns null while the torrent's size is still unknown", () => {
    expect(computeProgress(0, 0)).toBeNull();
  });

  it("distinguishes unknown size from a genuine 0%", () => {
    expect(computeProgress(0, 0)).toBeNull();
    expect(computeProgress(1000, 1000)).toBe(0);
  });

  it("computes a partial download", () => {
    expect(computeProgress(1000, 750)).toBe(25);
    expect(computeProgress(1000, 250)).toBe(75);
  });

  it("reports a finished download as 100", () => {
    expect(computeProgress(1000, 0)).toBe(100);
  });

  it("clamps if the client reports more downloaded than the total", () => {
    // qBittorrent can over-report slightly on completion.
    expect(computeProgress(1000, -50)).toBe(100);
  });

  it("never returns a negative percentage", () => {
    expect(computeProgress(1000, 1500)).toBe(0);
  });

  it("treats a negative size as unknown rather than dividing by it", () => {
    expect(computeProgress(-1, 0)).toBeNull();
  });
});
