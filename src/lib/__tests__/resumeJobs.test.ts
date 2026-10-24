import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAVE_UP_ERROR, HEARTBEAT_MS, INTERRUPTED_ERROR, STALE_AFTER_MS } from "../resumeJobRules";
import { HELD_STEP } from "../deployDrainRules";

type Row = {
  id: string;
  postingId: string;
  status: string;
  step: string;
  error: string | null;
  note: string | null;
  versionId: string | null;
  requestedBy: string;
  attempts: number;
  startedAt: Date;
  updatedAt: Date;
  heartbeatAt: Date;
};

const rows: Row[] = [];
let n = 0;
const matches = (
  r: Row,
  where: { id?: string; postingId?: string; status?: string | { in: string[] }; step?: string; heartbeatAt?: Date }
) =>
  (!where.heartbeatAt || +r.heartbeatAt === +where.heartbeatAt) &&
  (where.step === undefined || r.step === where.step) &&
  (!where.id || r.id === where.id) &&
  (!where.postingId || r.postingId === where.postingId) &&
  (!where.status || (typeof where.status === "string" ? r.status === where.status : where.status.in.includes(r.status)));

vi.mock("../db", () => ({
  prisma: {
    jobPosting: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "gone" ? null : { id: where.id }) },
    resumeJob: {
      findFirst: async ({ where }: { where: Parameters<typeof matches>[1] }) =>
        rows.filter((r) => matches(r, where)).sort((a, b) => +b.startedAt - +a.startedAt)[0] ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.filter((r) => matches(r, where)),
      create: async ({ data }: { data: Partial<Row> }) => {
        const now = new Date();
        const row: Row = {
          id: `job${++n}`, postingId: "", status: "queued", step: "", error: null, note: null, versionId: null,
          requestedBy: "", attempts: 1, startedAt: now, updatedAt: now, heartbeatAt: now, ...data,
        };
        rows.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Parameters<typeof matches>[1]; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
  },
}));
vi.mock("../auditLog", () => ({ logAudit: async () => undefined }));
let draining = false;
vi.mock("../deployDrain", () => ({ isDraining: async () => draining }));

let finish: (r: { ok: true; id: string; note: string | null } | { ok: false; error: string }) => void = () => {};
vi.mock("../resume", () => ({
  generateTailoredResume: vi.fn(
    async (_id: string, opts: { onStep?: (s: string) => Promise<void> }) => {
      await opts.onStep?.("Reading the listing");
      await opts.onStep?.("Researching and drafting");
      return new Promise((resolve) => (finish = resolve));
    }
  ),
}));

const { startResumeJob, getResumeJob, recoverInterruptedJobs } = await import("../resumeJobs");
const { generateTailoredResume } = await import("../resume");
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  rows.length = 0;
  draining = false;
  vi.mocked(generateTailoredResume).mockClear();
});

describe("startResumeJob", () => {
  it("starts one job per posting: a second tap gets the running one back", async () => {
    const [a, b] = await Promise.all([startResumeJob("p1", "jaker"), startResumeJob("p1", "jaker")]);
    expect(a.ok && b.ok && a.job.id === b.job.id).toBe(true);
    const c = await startResumeJob("p1", "jaker");
    expect(c.ok && c.existing && a.ok && c.job.id === a.job.id).toBe(true);
    expect(rows).toHaveLength(1);
    expect(generateTailoredResume).toHaveBeenCalledTimes(1);
    await tick();
    expect(rows[0].step).toBe("Researching and drafting");
    expect(rows[0].status).toBe("running");

    finish({ ok: true, id: "ver1", note: "Couldn't read the listing page; tailored from web research" });
    await tick();
    const done = await getResumeJob(rows[0].id);
    expect(done).toMatchObject({ status: "succeeded", versionId: "ver1", note: expect.stringContaining("Couldn't read") });
  });

  it("records a failure plainly", async () => {
    await startResumeJob("p2", "jaker");
    await tick();
    finish({ ok: false, error: "The model call failed: timed out" });
    await tick();
    expect(await getResumeJob(rows[0].id)).toMatchObject({ status: "failed", error: "The model call failed: timed out" });
  });

  it("replaces a job a restart killed, writing down that it was interrupted", async () => {
    const old = new Date(Date.now() - STALE_AFTER_MS - 5_000);
    rows.push({
      id: "dead", postingId: "p3", status: "running", step: "Reviewing", error: null, note: null, versionId: null,
      requestedBy: "jaker", attempts: 1, startedAt: old, updatedAt: old, heartbeatAt: old,
    });
    expect((await getResumeJob("dead"))?.status).toBe("failed");
    const r = await startResumeJob("p3", "jaker");
    expect(r.ok && r.job.id !== "dead").toBe(true);
    expect(rows.find((x) => x.id === "dead")).toMatchObject({ status: "failed", error: INTERRUPTED_ERROR });
    finish({ ok: false, error: "x" });
  });

  it("refuses a listing that no longer exists", async () => {
    expect(await startResumeJob("gone", "jaker")).toEqual({ ok: false, status: 404, error: "That listing no longer exists." });
  });
});

describe("recoverInterruptedJobs (server boot)", () => {
  const dead = (id: string, over: Partial<Row> = {}): Row => {
    const t = new Date(Date.now() - 60_000);
    return {
      id, postingId: `post-${id}`, status: "running", step: "Reviewing", error: null, note: null, versionId: null,
      requestedBy: "jaker", attempts: 1, startedAt: new Date(Date.now() - 5 * 60_000), updatedAt: t, heartbeatAt: t, ...over,
    };
  };

  it("re-runs a job the restart killed, under the same id, and counts the attempt", async () => {
    rows.push(dead("a"));
    await recoverInterruptedJobs(false);
    await tick();
    expect(generateTailoredResume).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ id: "a", status: "running", attempts: 2, error: null });
    finish({ ok: true, id: "ver-a", note: null });
    await tick();
    expect(await getResumeJob("a")).toMatchObject({ status: "succeeded", versionId: "ver-a" });
  });

  it("gives up after three runs, and on jobs abandoned long ago", async () => {
    rows.push(dead("b", { attempts: 3 }), dead("c", { startedAt: new Date(Date.now() - 3600_000) }));
    await recoverInterruptedJobs(false);
    expect(generateTailoredResume).not.toHaveBeenCalled();
    expect(rows.find((r) => r.id === "b")).toMatchObject({ status: "failed", error: GAVE_UP_ERROR });
    expect(rows.find((r) => r.id === "c")).toMatchObject({ status: "failed", error: INTERRUPTED_ERROR });
  });

  it("leaves a job whose heartbeat is still fresh (an old container may still own it)", async () => {
    rows.push(dead("d", { heartbeatAt: new Date() }));
    await recoverInterruptedJobs(false);
    expect(generateTailoredResume).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "running", attempts: 1 });
  });
});

describe("while a deploy is draining", () => {
  it("holds a new job instead of starting it, then starts it once the drain ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    try {
      draining = true;
      const r = await startResumeJob("h1", "jaker");
      expect(r.ok && r.job.status).toBe("queued");
      expect(rows[0]).toMatchObject({ status: "queued", step: HELD_STEP, attempts: 1 });
      expect(generateTailoredResume).not.toHaveBeenCalled();

      // Still draining: kept alive, not started.
      rows[0].heartbeatAt = new Date(Date.now() - 60_000);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(generateTailoredResume).not.toHaveBeenCalled();
      expect(Date.now() - +rows[0].heartbeatAt).toBeLessThan(5_000);

      // The deploy gave up or the TTL ran out without a restart.
      draining = false;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(generateTailoredResume).toHaveBeenCalledTimes(1);
      expect(rows[0]).toMatchObject({ status: "running", attempts: 1 });
      finish({ ok: true, id: "ver-h1", note: null });
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a held job picked up after the restart is a first attempt, not a retry", async () => {
    const t = new Date(Date.now() - 60_000);
    rows.push({
      id: "held", postingId: "h2", status: "queued", step: HELD_STEP, error: null, note: null, versionId: null,
      requestedBy: "jaker", attempts: 1, startedAt: new Date(Date.now() - 5 * 60_000), updatedAt: t, heartbeatAt: t,
    });
    draining = true; // the deploy hasn't cleared the flag yet; the restart already happened
    await recoverInterruptedJobs(false);
    await tick();
    expect(generateTailoredResume).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ id: "held", status: "running", attempts: 1 });
    finish({ ok: false, error: "x" });
  });
});
