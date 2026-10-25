import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../notify", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("../auditLog", () => ({ logAudit: vi.fn(async () => undefined) }));

import { notify } from "../notify";
import { notifyStartedOnce, startRun } from "../skillRunner";
import type { SkillInfo, SkillRun } from "../skillRunnerRules";

const skill: SkillInfo = { name: "health-sweep", description: "", kind: "read", args: [] };
const choice = { engine: "claude" } as Parameters<typeof startRun>[3];

const run = (over: Partial<SkillRun>): SkillRun => ({
  id: "r1",
  skill: "health-sweep",
  args: {},
  requestedBy: "jaker",
  status: "running",
  startedAt: "2026-10-25T10:00:00Z",
  finishedAt: null,
  output: "",
  summary: null,
  links: [],
  ...over,
});

function answerStart(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 202 })));
}

beforeEach(() => {
  vi.stubEnv("SKILL_RUNNER_URL", "http://runner.test");
  vi.stubEnv("SKILL_RUNNER_TOKEN", "t");
  vi.mocked(notify).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the 'skill started' email", () => {
  it("goes out at once for a run that began, and only once", async () => {
    answerStart({ id: "a1", run_id: "a1", status: "running", position: 0 });
    const r = await startRun(skill, {}, "jaker", choice);
    expect(r).toMatchObject({ ok: true, data: { id: "a1", status: "running" } });
    expect(notify).toHaveBeenCalledTimes(1);
    notifyStartedOnce(run({ id: "a1" }));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("goes out at once for the old {id} answer", async () => {
    answerStart({ id: "a2" });
    await startRun(skill, {}, "jaker", choice);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("waits while the run is queued, and goes out when it starts", async () => {
    answerStart({ id: "q1", run_id: "q1", status: "queued", position: 2 });
    const r = await startRun(skill, {}, "jaker", choice);
    expect(r).toMatchObject({ ok: true, data: { id: "q1", status: "queued", position: 2 } });
    expect(notify).not.toHaveBeenCalled();

    notifyStartedOnce(run({ id: "q1", status: "queued", startedAt: null, position: 1 }));
    expect(notify).not.toHaveBeenCalled();

    notifyStartedOnce(run({ id: "q1", status: "running" }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toBe("Skill health-sweep started from admin chat by jaker");

    // Later polls of the same run send nothing more.
    notifyStartedOnce(run({ id: "q1", status: "running" }));
    notifyStartedOnce(run({ id: "q1", status: "succeeded" }));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("goes out for a queued run seen only after it finished", async () => {
    answerStart({ id: "q2", status: "queued", position: 1 });
    await startRun(skill, {}, "jaker", choice);
    notifyStartedOnce(run({ id: "q2", status: "succeeded", finishedAt: "2026-10-25T10:01:00Z" }));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("never goes out for a run removed from the queue", async () => {
    answerStart({ id: "q3", status: "queued", position: 1 });
    await startRun(skill, {}, "jaker", choice);
    notifyStartedOnce(run({ id: "q3", status: "cancelled", startedAt: null }));
    notifyStartedOnce(run({ id: "q3", status: "cancelled", startedAt: null }));
    expect(notify).not.toHaveBeenCalled();
  });

  it("is not sent for a run that was never queued by this process", () => {
    notifyStartedOnce(run({ id: "someone-elses", status: "running" }));
    expect(notify).not.toHaveBeenCalled();
  });
});
