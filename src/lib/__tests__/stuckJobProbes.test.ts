import { describe, expect, it } from "vitest";
import {
  KILL_NOTICE_WINDOW_HOURS,
  quarantineVerdict,
  stuckJobVerdict,
} from "../healthProbeRules";

const NOW = new Date("2026-09-26T20:00:00Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3600_000).toISOString();
}

describe("stuckJobVerdict", () => {
  it("passes when nothing has been killed", () => {
    const v = stuckJobVerdict([], NOW);
    expect(v.status).toBe("pass");
  });

  it("fails on a kill inside the notice window", () => {
    // The real case: a chdman that burned a core for 2.7 days writing nothing.
    const v = stuckJobVerdict(
      [{ name: "chdman", reason: "burned CPU without writing for 47m", at: hoursAgo(2) }],
      NOW
    );
    expect(v.status).toBe("fail");
    expect(v.detail).toContain("chdman");
    expect(v.detail).toContain("47m");
  });

  it("clears itself once the kill ages out", () => {
    // Deliberate: the published file keeps a week of kills so a job killed
    // every run is visible, but one kill a fortnight ago is history. Without
    // this the probe would need a human to acknowledge it.
    const v = stuckJobVerdict(
      [{ name: "chdman", reason: "stalled", at: hoursAgo(KILL_NOTICE_WINDOW_HOURS + 1) }],
      NOW
    );
    expect(v.status).toBe("pass");
  });

  it("counts repeated kills, which is the worse problem", () => {
    const v = stuckJobVerdict(
      [
        { name: "chdman", reason: "stalled", at: hoursAgo(1) },
        { name: "chdman", reason: "stalled", at: hoursAgo(3) },
        { name: "chdman", reason: "stalled", at: hoursAgo(5) },
      ],
      NOW
    );
    expect(v.status).toBe("fail");
    expect(v.detail).toContain("3 killed");
  });

  it("ignores entries with an unparseable timestamp rather than trusting them", () => {
    expect(stuckJobVerdict([{ name: "chdman", at: "not a date" }], NOW).status).toBe("pass");
    expect(stuckJobVerdict([{ name: "chdman" }], NOW).status).toBe("pass");
  });

  it("skips rather than passes when the file could not be read", () => {
    // A probe that cannot see must not report healthy.
    expect(stuckJobVerdict(null, NOW).status).toBe("skip");
  });
});

describe("quarantineVerdict", () => {
  it("passes when nothing has been given up on", () => {
    expect(quarantineVerdict([]).status).toBe("pass");
  });

  it("fails while a file stays quarantined, and says what to do", () => {
    // The three real ones, which failed on every hourly run for eleven days.
    const v = quarantineVerdict([
      { path: "/data/roms/ps2/God of War II (USA).iso", failures: 3 },
      { path: "/data/roms/ps2/Killzone (USA).iso", failures: 3 },
    ]);
    expect(v.status).toBe("fail");
    expect(v.detail).toContain("God of War II (USA).iso");
    // Names only, not full paths -- the panel line stays readable.
    expect(v.detail).not.toContain("/data/roms");
    expect(v.detail).toContain("nothing will retry them");
  });

  it("does not list every file when there are many", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      path: `/data/roms/ps2/Title ${i}.iso`,
      failures: 3,
    }));
    const v = quarantineVerdict(many);
    expect(v.detail).toContain("9 given up on");
    expect(v.detail).toContain("Title 0.iso");
    expect(v.detail).not.toContain("Title 8.iso");
  });

  it("skips rather than passes when the file could not be read", () => {
    expect(quarantineVerdict(null).status).toBe("skip");
  });
});
