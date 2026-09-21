import { describe, expect, it } from "vitest";
import { sortRenewals, type Renewal } from "../renewals";

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
