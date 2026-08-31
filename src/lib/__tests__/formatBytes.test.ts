import { describe, it, expect } from "vitest";
import { formatFileSize } from "../formatBytes";

describe("formatFileSize", () => {
  it("returns null for missing or non-positive sizes", () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(undefined)).toBeNull();
    expect(formatFileSize(0)).toBeNull();
    expect(formatFileSize(-5)).toBeNull();
    expect(formatFileSize(NaN)).toBeNull();
  });

  it("shows one decimal MB under 10 MB", () => {
    expect(formatFileSize(5.5 * 1024 ** 2)).toBe("5.5 MB");
  });

  it("shows whole-number MB from 10 MB up to 1 GB", () => {
    expect(formatFileSize(350 * 1024 ** 2)).toBe("350 MB");
    expect(formatFileSize(999 * 1024 ** 2)).toBe("999 MB");
  });

  it("switches to GB at 1000 MB", () => {
    expect(formatFileSize(1000 * 1024 ** 2)).toBe("1.0 GB");
    expect(formatFileSize(2.4 * 1024 ** 3)).toBe("2.4 GB");
  });

  it("switches to TB at 1000 GB", () => {
    expect(formatFileSize(1000 * 1024 ** 3)).toBe("1.0 TB");
  });
});
