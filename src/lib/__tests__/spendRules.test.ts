import { describe, it, expect } from "vitest";
import {
  byDueSoonest,
  computeTotals,
  daysUntil,
  describeCost,
  describeDue,
  dueUrgencyClass,
  monthlyEquivalent,
} from "../spendRules";

const sub = (name: string, cost: number, cadence: string, active = true) => ({
  name, cost, cadence, active,
});

describe("monthlyEquivalent", () => {
  it("passes a monthly price through", () => {
    expect(monthlyEquivalent(12, "monthly")).toBe(12);
  });

  it("divides a yearly price", () => {
    expect(monthlyEquivalent(120, "yearly")).toBe(10);
  });

  // Metered has no fixed price to normalise and free has none to count.
  // Guessing a number for either would make the headline quietly wrong.
  it("contributes nothing for metered or free", () => {
    expect(monthlyEquivalent(50, "metered")).toBe(0);
    expect(monthlyEquivalent(0, "free")).toBe(0);
  });

  it("ignores nonsense costs rather than propagating NaN into the total", () => {
    expect(monthlyEquivalent(NaN, "monthly")).toBe(0);
    expect(monthlyEquivalent(-5, "monthly")).toBe(0);
  });
});

describe("computeTotals", () => {
  it("sums fixed costs, normalising yearly to monthly", () => {
    const t = computeTotals([sub("A", 10, "monthly"), sub("B", 60, "yearly")]);
    expect(t.fixedMonthly).toBe(15);
    expect(t.totalMonthly).toBe(15);
  });

  it("ignores cancelled subscriptions but keeps them in the list", () => {
    const t = computeTotals([sub("A", 10, "monthly"), sub("Old", 99, "monthly", false)]);
    expect(t.fixedMonthly).toBe(10);
  });

  // The point of separating these: a flat $10/mo and a variable AWS bill are
  // different kinds of number, and only what was actually billed should count.
  it("adds metered services at what they actually billed", () => {
    const t = computeTotals(
      [sub("AWS", 0, "metered"), sub("Plex", 5, "monthly")],
      { AWS: 12.34 }
    );
    expect(t.meteredMonthly).toBeCloseTo(12.34);
    expect(t.totalMonthly).toBeCloseTo(17.34);
  });

  // A total that silently omits something is worse than one that says so.
  it("names metered services it couldn't read, rather than assuming zero", () => {
    const t = computeTotals([sub("AWS", 0, "metered"), sub("OpenRouter", 0, "metered")], {
      AWS: 5,
    });
    expect(t.unknownMetered).toEqual(["OpenRouter"]);
    expect(t.meteredMonthly).toBe(5);
  });

  it("treats a null live figure as unknown, not as zero spend", () => {
    const t = computeTotals([sub("AWS", 0, "metered")], { AWS: null });
    expect(t.unknownMetered).toEqual(["AWS"]);
  });

  it("reports nothing owed for an empty or all-free list", () => {
    expect(computeTotals([]).totalMonthly).toBe(0);
    expect(computeTotals([sub("Free thing", 0, "free")]).totalMonthly).toBe(0);
  });
});

describe("describeCost", () => {
  it("shows a yearly price with its monthly equivalent", () => {
    expect(describeCost(120, "yearly")).toBe("$120.00/yr ($10.00/mo)");
  });

  it("labels the cadences that have no fixed price", () => {
    expect(describeCost(0, "metered")).toBe("Metered");
    expect(describeCost(0, "free")).toBe("Free");
  });

  it("shows a monthly price plainly", () => {
    expect(describeCost(8.99, "monthly")).toBe("$8.99/mo");
  });
});

describe("daysUntil", () => {
  it("counts whole days forward", () => {
    // Half a day past the mark, so the floor is 10 however many milliseconds
    // pass before daysUntil reads the clock. An exact multiple of 86_400_000
    // races the two Date.now() calls and lands on 9 or 10 by machine speed.
    const target = new Date(Date.now() + 10.5 * 86_400_000).toISOString();
    expect(daysUntil(target)).toBe(10);
  });

  it("goes negative once the date has passed", () => {
    const target = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(daysUntil(target)).toBeLessThan(0);
  });
});

describe("describeDue", () => {
  it("names the near dates rather than counting them", () => {
    expect(describeDue(0)).toBe("today");
    expect(describeDue(1)).toBe("tomorrow");
  });

  it("counts forward in days beyond that", () => {
    expect(describeDue(24)).toBe("in 24d");
  });

  it("says how far overdue, not how negative", () => {
    expect(describeDue(-3)).toBe("3d overdue");
  });

  it("distinguishes no date from an unreadable one", () => {
    expect(describeDue(null)).toBe("no date");
    expect(describeDue(null, "RDAP timed out")).toBe("unknown");
    // A problem wins even when a stale number is still on the row.
    expect(describeDue(12, "RDAP timed out")).toBe("unknown");
  });
});

describe("dueUrgencyClass", () => {
  it("escalates as the date approaches", () => {
    expect(dueUrgencyClass(-1)).toContain("red");
    expect(dueUrgencyClass(3)).toContain("amber-300");
    expect(dueUrgencyClass(14)).toContain("amber-200");
    expect(dueUrgencyClass(90)).toContain("white");
  });

  it("does not alarm about a row with no date", () => {
    expect(dueUrgencyClass(null)).toContain("white");
  });
});

describe("byDueSoonest", () => {
  it("puts the soonest first", () => {
    const sorted = [{ daysLeft: 30 }, { daysLeft: 2 }, { daysLeft: 9 }].sort(byDueSoonest);
    expect(sorted.map((r) => r.daysLeft)).toEqual([2, 9, 30]);
  });

  it("keeps overdue rows at the very top", () => {
    const sorted = [{ daysLeft: 1 }, { daysLeft: -5 }].sort(byDueSoonest);
    expect(sorted[0].daysLeft).toBe(-5);
  });

  it("sinks undated rows rather than treating them as urgent", () => {
    // Both spellings of "no date": a probed renewal sets null, a spend row
    // simply omits the field.
    const sorted = [{ daysLeft: null }, {}, { daysLeft: 40 }].sort(byDueSoonest);
    expect(sorted[0].daysLeft).toBe(40);
  });
});
