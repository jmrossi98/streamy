import { describe, it, expect } from "vitest";
import {
  assessLoginActivity,
  assessExposure,
  overallSeverity,
  type LoginActivity,
  SUSTAINED_ATTACK_FAILURES,
  ELEVATED_FAILURE_VOLUME,
  DISTRIBUTED_SOURCE_COUNT,
  ENUMERATION_ATTEMPTS,
} from "../securityRules";

const quiet: LoginActivity = {
  failuresLast24h: 0,
  successesLast24h: 4,
  distinctFailedIps: 0,
  topIp: null,
  unknownUserAttempts: 0,
  lockedOutAttempts: 0,
  signups: 0,
};

const ids = (a: LoginActivity) => assessLoginActivity(a).map((f) => f.id);

describe("assessLoginActivity", () => {
  // An alert that fires on ordinary use gets muted, and a muted alert is worse
  // than no alert.
  it("reports nothing on a quiet day", () => {
    expect(assessLoginActivity(quiet)).toEqual([]);
  });

  it("stays quiet for a few typos", () => {
    expect(ids({ ...quiet, failuresLast24h: 3, distinctFailedIps: 1, topIp: { ip: "1.1.1.1", failures: 3 } })).toEqual([]);
  });

  it("flags sustained guessing from one address as critical", () => {
    const found = assessLoginActivity({
      ...quiet,
      failuresLast24h: SUSTAINED_ATTACK_FAILURES,
      distinctFailedIps: 1,
      topIp: { ip: "9.9.9.9", failures: SUSTAINED_ATTACK_FAILURES },
    });
    const attack = found.find((f) => f.id === "auth.sustained_attack");
    expect(attack?.severity).toBe("critical");
    expect(attack?.detail).toContain("9.9.9.9");
  });

  it("flags elevated total volume", () => {
    expect(ids({ ...quiet, failuresLast24h: ELEVATED_FAILURE_VOLUME, distinctFailedIps: 2 })).toContain(
      "auth.failure_volume"
    );
  });

  // Spraying never trips a per-account counter, so breadth is its own signal.
  it("flags many distinct sources even when each fails only a little", () => {
    expect(
      ids({
        ...quiet,
        failuresLast24h: DISTRIBUTED_SOURCE_COUNT,
        distinctFailedIps: DISTRIBUTED_SOURCE_COUNT,
        topIp: { ip: "1.1.1.1", failures: 1 },
      })
    ).toContain("auth.distributed_sources");
  });

  it("flags probing for accounts that don't exist", () => {
    expect(ids({ ...quiet, unknownUserAttempts: ENUMERATION_ATTEMPTS })).toContain("auth.enumeration");
  });

  it("treats an active lockout as informational, not an alarm", () => {
    const found = assessLoginActivity({ ...quiet, lockedOutAttempts: 3 });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  // Alerting dedupes on id, so an id carrying a count would re-alert on every
  // new failure and defeat the point.
  it("uses stable ids that don't embed counts", () => {
    const a = ids({ ...quiet, failuresLast24h: 50, distinctFailedIps: 2 });
    const b = ids({ ...quiet, failuresLast24h: 900, distinctFailedIps: 2 });
    expect(a).toEqual(b);
  });
});

describe("assessExposure", () => {
  it("treats a reachable internal service as critical", () => {
    const f = assessExposure("Ollama", true);
    expect(f.severity).toBe("critical");
    expect(f.id).toBe("exposure.Ollama");
  });

  it("treats an unreachable one as fine", () => {
    expect(assessExposure("Ollama", false).severity).toBe("info");
  });

  it("keeps the same id either way so state changes are comparable", () => {
    expect(assessExposure("SearXNG", true).id).toBe(assessExposure("SearXNG", false).id);
  });
});

describe("overallSeverity", () => {
  it("is info when everything passes", () => {
    expect(overallSeverity([assessExposure("Ollama", false)])).toBe("info");
  });

  it("is critical when anything is critical", () => {
    expect(
      overallSeverity([assessExposure("Ollama", false), assessExposure("SearXNG", true)])
    ).toBe("critical");
  });

  it("prefers critical over warning", () => {
    expect(
      overallSeverity([
        { id: "a", severity: "warning", title: "", detail: "" },
        { id: "b", severity: "critical", title: "", detail: "" },
      ])
    ).toBe("critical");
  });
});
