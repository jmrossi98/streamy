import { describe, it, expect } from "vitest";
import { diskProblems, summarizeSmart, type SmartDisk } from "../smartHealth";

/**
 * A healthy disk, matching the real snapshot shape mediabox publishes. Each
 * test mutates one field, so what a case is actually about stays obvious.
 */
function disk(over: Partial<SmartDisk> = {}): SmartDisk {
  return {
    device: "/dev/sdb",
    model: "ST8000VN004-3CP101",
    serialTail: "1FQ8",
    healthPassed: true,
    temperatureC: 45,
    powerOnHours: 2,
    reallocatedSectors: 0,
    pendingSectors: 0,
    offlineUncorrectable: 0,
    crcErrors: 0,
    failingAttributes: [],
    ...over,
  };
}

describe("diskProblems", () => {
  it("finds nothing wrong with a healthy disk", () => {
    expect(diskProblems(disk())).toEqual([]);
  });

  // A healthy drive reports zero for its entire life, so one is not "a small
  // normal number" -- it is the beginning of the end, and must not be rounded
  // away as noise.
  it("treats a single reallocated sector as a problem", () => {
    expect(diskProblems(disk({ reallocatedSectors: 1 }))[0]).toMatch(/1 reallocated/);
  });

  it("reports pending and uncorrectable sectors", () => {
    expect(diskProblems(disk({ pendingSectors: 3 }))[0]).toMatch(/3 pending/);
    expect(diskProblems(disk({ offlineUncorrectable: 2 }))[0]).toMatch(/2 uncorrectable/);
  });

  // CRC errors are the cable, not the platter. Saying so is the difference
  // between reseating a connector and buying a drive.
  it("points CRC errors at the cable", () => {
    expect(diskProblems(disk({ crcErrors: 4 }))[0]).toMatch(/SATA cable/);
  });

  it("leads with the drive's own verdict when SMART says it is failing", () => {
    expect(diskProblems(disk({ healthPassed: false }))[0]).toMatch(/SMART says FAILING/);
  });

  it("surfaces an attribute the drive itself flagged", () => {
    const problems = diskProblems(disk({ failingAttributes: ["Spin_Retry_Count"] }));
    expect(problems[0]).toMatch(/Spin_Retry_Count failed/);
  });

  // The temperature the box actually runs at must not itself be a problem,
  // or the row is red forever and stops meaning anything.
  it("does not treat the current 45C baseline as a problem", () => {
    expect(diskProblems(disk({ temperatureC: 45 }))).toEqual([]);
  });

  it("treats a genuinely hot drive as a problem", () => {
    expect(diskProblems(disk({ temperatureC: 62 }))[0]).toMatch(/62C/);
  });
});

describe("summarizeSmart", () => {
  it("summarises healthy disks with a temperature range", () => {
    const s = summarizeSmart({
      generatedAt: "2026-09-24T02:42:41Z",
      disks: [disk({ device: "/dev/sda", temperatureC: 43 }), disk({ temperatureC: 45 })],
    });
    expect(s.ok).toBe(true);
    expect(s.detail).toBe("2 disks healthy, 43-45C");
  });

  it("collapses the range when every disk reads the same", () => {
    const s = summarizeSmart({
      generatedAt: "",
      disks: [disk({ device: "/dev/sda" }), disk()],
    });
    expect(s.detail).toBe("2 disks healthy, 45C");
  });

  // Warm is worth saying and not worth going red over: a check that cries
  // wolf about a summer afternoon is one people learn to ignore.
  it("notes a warm drive without failing the row", () => {
    const s = summarizeSmart({ generatedAt: "", disks: [disk({ temperatureC: 53 })] });
    expect(s.ok).toBe(true);
    expect(s.detail).toMatch(/running warm/);
  });

  it("fails the row once a disk is genuinely overheating", () => {
    const s = summarizeSmart({ generatedAt: "", disks: [disk({ temperatureC: 65 })] });
    expect(s.ok).toBe(false);
  });

  it("fails the row and names every problem across disks", () => {
    const s = summarizeSmart({
      generatedAt: "",
      disks: [disk({ device: "/dev/sda", pendingSectors: 2 }), disk({ crcErrors: 1 })],
    });
    expect(s.ok).toBe(false);
    expect(s.detail).toMatch(/sda: 2 pending/);
    expect(s.detail).toMatch(/sdb: 1 CRC/);
  });

  // The publisher refuses to write this, but if an empty list ever arrives it
  // must not read as "everything is fine" -- that is the worst way for a
  // health check to fail.
  it("refuses to call an empty disk list healthy", () => {
    const s = summarizeSmart({ generatedAt: "", disks: [] });
    expect(s.ok).toBe(false);
    expect(s.detail).toMatch(/no disks/i);
  });
});
