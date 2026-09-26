import { describe, expect, it } from "vitest";
import {
  FRESHNESS_LIMITS_MINUTES,
  freshnessVerdict,
  regrabVerdict,
  REGRAB_LOOP_THRESHOLD,
  searchVerdict,
  stuckImportVerdict,
  STUCK_IMPORT_MINUTES,
  summarise,
} from "../healthProbeRules";

/**
 * Each of these encodes a failure that actually happened and that nothing
 * reported at the time. They are thresholds, so the risk is not that they
 * break loudly -- it is that someone widens one to silence a noisy alert and
 * turns the probe into decoration.
 */
describe("freshnessVerdict", () => {
  it("passes a file written within its limit", () => {
    const v = freshnessVerdict("metrics-24h.json", 5);
    expect(v.status).toBe("pass");
  });

  it("fails a file that stopped advancing", () => {
    // The real incident: metrics-sample.sh failed for nine hours while the
    // file kept being served with HTTP 200. Every reachability check passed.
    const v = freshnessVerdict("metrics-24h.json", 9 * 60);
    expect(v.status).toBe("fail");
    expect(v.detail).toContain("9h");
  });

  it("treats an unreadable timestamp as a failure, not a pass", () => {
    // A missing generatedAt is how a truncated or half-written file presents.
    expect(freshnessVerdict("metrics-24h.json", null).status).toBe("fail");
  });

  it("skips an artifact with no limit defined rather than inventing one", () => {
    expect(freshnessVerdict("not-a-real-file.json", 10).status).toBe("skip");
  });

  it("gives hand-published artifacts far longer than cron-published ones", () => {
    // docs-index is rebuilt by hand; metrics every five minutes. One limit
    // for both would either page on the first or never fire on the second.
    expect(FRESHNESS_LIMITS_MINUTES["docs-index.json"]).toBeGreaterThan(
      FRESHNESS_LIMITS_MINUTES["metrics-24h.json"] * 100
    );
  });
});

describe("stuckImportVerdict", () => {
  it("passes when nothing is waiting", () => {
    expect(stuckImportVerdict([]).status).toBe("pass");
  });

  it("ignores an import that is merely recent", () => {
    // A cross-filesystem copy of a large file takes minutes; firing on that
    // would make the probe useless within a week.
    const v = stuckImportVerdict([{ title: "x", ageMinutes: STUCK_IMPORT_MINUTES - 1 }]);
    expect(v.status).toBe("pass");
  });

  it("fails on a download wedged past the limit and names it", () => {
    // Two Gurren Lagann films sat in importPending indefinitely because
    // fansub names carry no SxxExx. Sonarr reported healthy throughout.
    const v = stuckImportVerdict([
      { title: "[Commie] Gurren Lagann The Movie", ageMinutes: 400 },
      { title: "recent", ageMinutes: 2 },
    ]);
    expect(v.status).toBe("fail");
    expect(v.detail).toContain("Gurren Lagann");
    expect(v.detail).toContain("1 stuck");
  });
});

describe("regrabVerdict", () => {
  it("passes when nothing repeats", () => {
    expect(regrabVerdict({ "a release": 1, "another": 2 }).status).toBe("pass");
  });

  it("fails once a release repeats past the threshold", () => {
    // The healer bug produced grabs twenty seconds apart and 542 history
    // records; what reached a human was a download resetting from 44% to 7%.
    const v = regrabVerdict({ "looping release": REGRAB_LOOP_THRESHOLD });
    expect(v.status).toBe("fail");
    expect(v.detail).toContain("looping release");
  });

  it("reports the worst offender first", () => {
    const v = regrabVerdict({ mild: 3, worst: 40 });
    expect(v.detail.indexOf("worst")).toBeLessThan(v.detail.indexOf("mild"));
  });
});

describe("searchVerdict", () => {
  it("fails on zero results for a title every indexer carries", () => {
    // Reachable indexers producing nothing is what a dead API key or a
    // blocked exit IP looks like, and no status row shows it.
    expect(searchVerdict("The Matrix", 0).status).toBe("fail");
  });

  it("fails when the search did not complete", () => {
    expect(searchVerdict("The Matrix", null).status).toBe("fail");
  });

  it("passes on any usable result", () => {
    expect(searchVerdict("The Matrix", 1).status).toBe("pass");
  });
});

describe("summarise", () => {
  const ok = { id: "a", name: "A", status: "pass" as const, detail: "" };
  const bad = { id: "b", name: "B", status: "fail" as const, detail: "" };
  const na = { id: "c", name: "C", status: "skip" as const, detail: "" };

  it("counts only probes that ran", () => {
    // A skipped probe is not a passing one; counting it would report
    // "3/3 passed" on a box with two integrations unconfigured.
    const s = summarise([ok, ok, na]);
    expect(s.success).toBe(true);
    expect(s.summary).toBe("2/2 probes passed");
  });

  it("fails the run and names the failures", () => {
    const s = summarise([ok, bad]);
    expect(s.success).toBe(false);
    expect(s.summary).toContain("B");
  });
});
