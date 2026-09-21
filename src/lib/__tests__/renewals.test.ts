import { describe, expect, it } from "vitest";
import { manualRenewals, sortRenewals, type Renewal } from "../renewals";

function row(partial: Partial<Renewal>): Renewal {
  return {
    name: "thing",
    source: "manual",
    expiresUtc: null,
    daysLeft: null,
    detail: "",
    ...partial,
  };
}

describe("manualRenewals", () => {
  it("ignores rows with no date, which is most of them", () => {
    expect(
      manualRenewals([{ name: "Plex", renewsAt: null, active: true }])
    ).toEqual([]);
  });

  it("ignores cancelled rows", () => {
    expect(
      manualRenewals([
        { name: "Old usenet block", renewsAt: new Date("2027-01-01"), active: false },
      ])
    ).toEqual([]);
  });

  it("counts days from a stored date", () => {
    const in10Days = new Date(Date.now() + 10 * 86_400_000);
    const [r] = manualRenewals([
      { name: "Usenet block", renewsAt: in10Days, active: true },
    ]);
    expect(r.name).toBe("Usenet block");
    expect(r.source).toBe("manual");
    expect(r.daysLeft).toBe(9); // floor of just under 10 whole days
  });

  it("reports a lapsed date as negative rather than dropping it", () => {
    const yesterday = new Date(Date.now() - 2 * 86_400_000);
    const [r] = manualRenewals([
      { name: "Lapsed thing", renewsAt: yesterday, active: true },
    ]);
    expect(r.daysLeft).toBeLessThan(0);
  });
});

describe("sortRenewals", () => {
  it("puts the soonest first", () => {
    const sorted = sortRenewals([
      row({ name: "later", expiresUtc: "2027-01-01T00:00:00.000Z" }),
      row({ name: "sooner", expiresUtc: "2026-10-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["sooner", "later"]);
  });

  it("sinks unreadable rows below real dates but keeps them", () => {
    // Deliberately kept: a list that quietly omits the one it couldn't read
    // looks like a list with nothing due.
    const sorted = sortRenewals([
      row({ name: "broken", problem: "403 from panel" }),
      row({ name: "fine", expiresUtc: "2027-01-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["fine", "broken"]);
  });

  it("puts a never-expiring row after dated ones", () => {
    const sorted = sortRenewals([
      row({ name: "forever", expiresUtc: null }),
      row({ name: "dated", expiresUtc: "2027-01-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["dated", "forever"]);
  });
});
