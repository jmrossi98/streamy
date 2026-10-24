import { describe, expect, it } from "vitest";
import {
  APPLE_NOTES_MAX_MS,
  DRAIN_TTL_MS,
  HELD_STEP,
  MAX_DRAIN_TTL_MS,
  RESUME_TYPICAL_MS,
  busyReport,
  drainDeadline,
  drainState,
} from "../deployDrainRules";

const NOW = Date.parse("2026-10-24T20:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);
const idle = { running: false, startedAt: null };
const base = { staleAfterMs: 120_000, capMs: 10.75 * 60_000 };

describe("drainState", () => {
  it("is draining only until its deadline", () => {
    expect(drainState(new Date(NOW + 60_000).toISOString(), NOW)).toEqual({
      draining: true,
      until: new Date(NOW + 60_000).toISOString(),
    });
    expect(drainState(new Date(NOW - 1).toISOString(), NOW).draining).toBe(false);
    expect(drainState(new Date(NOW).toISOString(), NOW).draining).toBe(false);
  });

  it("treats a missing or garbled flag as not draining", () => {
    expect(drainState(null, NOW).draining).toBe(false);
    expect(drainState("", NOW).draining).toBe(false);
    expect(drainState("true", NOW).draining).toBe(false);
  });

  it("never honours a deadline past the maximum TTL", () => {
    const s = drainState(new Date(NOW + 365 * 86400_000).toISOString(), NOW);
    expect(s).toEqual({ draining: true, until: new Date(NOW + MAX_DRAIN_TTL_MS).toISOString() });
  });
});

describe("drainDeadline", () => {
  it("defaults, clamps and ignores nonsense", () => {
    expect(+drainDeadline(NOW)).toBe(NOW + DRAIN_TTL_MS);
    expect(+drainDeadline(NOW, 60_000)).toBe(NOW + 60_000);
    expect(+drainDeadline(NOW, 10 * 3600_000)).toBe(NOW + MAX_DRAIN_TTL_MS);
    expect(+drainDeadline(NOW, 0)).toBe(NOW + DRAIN_TTL_MS);
    expect(+drainDeadline(NOW, -5)).toBe(NOW + DRAIN_TTL_MS);
    expect(+drainDeadline(NOW, NaN)).toBe(NOW + DRAIN_TTL_MS);
  });
});

describe("busyReport", () => {
  const job = (over: Partial<{ id: string; status: string; step: string; startedAt: Date; heartbeatAt: Date }> = {}) => ({
    id: "j1",
    status: "running",
    step: "Researching and drafting",
    startedAt: ago(3 * 60_000),
    heartbeatAt: ago(10_000),
    ...over,
  });

  it("is idle with nothing running", () => {
    expect(busyReport({ ...base, resumeJobs: [], appleNotes: idle }, NOW)).toEqual({ busy: false, jobs: [] });
  });

  it("counts a live resume job, with an eta from its usual length", () => {
    const r = busyReport({ ...base, resumeJobs: [job()], appleNotes: idle }, NOW);
    expect(r.busy).toBe(true);
    expect(r.jobs).toEqual([
      {
        kind: "resume",
        id: "j1",
        startedAt: ago(3 * 60_000).toISOString(),
        eta: new Date(NOW - 3 * 60_000 + RESUME_TYPICAL_MS).toISOString(),
      },
    ]);
  });

  it("never reports an eta in the past", () => {
    const r = busyReport({ ...base, resumeJobs: [job({ startedAt: ago(9 * 60_000) })], appleNotes: idle }, NOW);
    expect(r.jobs[0].eta).toBe(new Date(NOW).toISOString());
  });

  it("ignores dead, finished, held and overrun jobs", () => {
    const jobs = [
      job({ id: "dead", heartbeatAt: ago(5 * 60_000) }),
      job({ id: "done", status: "succeeded" }),
      job({ id: "held", status: "queued", step: HELD_STEP }),
      job({ id: "overrun", startedAt: ago(15 * 60_000) }),
    ];
    expect(busyReport({ ...base, resumeJobs: jobs, appleNotes: idle }, NOW)).toEqual({ busy: false, jobs: [] });
  });

  it("counts a queued job that is about to run", () => {
    const r = busyReport({ ...base, resumeJobs: [job({ status: "queued", step: "" })], appleNotes: idle }, NOW);
    expect(r.busy).toBe(true);
  });

  it("counts an Apple Notes sync in progress, unless it has hung", () => {
    const running = busyReport({ ...base, resumeJobs: [], appleNotes: { running: true, startedAt: ago(30_000) } }, NOW);
    expect(running).toEqual({
      busy: true,
      jobs: [{ kind: "apple-notes-sync", id: "apple-notes", startedAt: ago(30_000).toISOString(), eta: null }],
    });
    const hung = busyReport(
      { ...base, resumeJobs: [], appleNotes: { running: true, startedAt: ago(APPLE_NOTES_MAX_MS + 1) } },
      NOW
    );
    expect(hung.busy).toBe(false);
  });
});
