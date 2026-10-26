import { describe, expect, it } from "vitest";
import { planConflictRetry } from "../chatSaver";
import { dedupeRunTurns, type ChatTurn } from "../chatSessionRules";
import { runTurnContent, type SkillRun } from "../skillRunnerRules";

const u = (content: string): ChatTurn => ({ role: "user", content });
const a = (content: string): ChatTurn => ({ role: "assistant", content });
const run = (over: Partial<SkillRun> = {}): SkillRun => ({
  id: "run-1",
  skill: "health-sweep",
  args: {},
  requestedBy: "jaker",
  status: "running",
  startedAt: "2026-10-25T22:30:00Z",
  finishedAt: null,
  output: "",
  summary: null,
  links: [],
  ...over,
});
const runTurn = (over: Partial<SkillRun> = {}): ChatTurn => ({ role: "user", via: "skill-run", content: runTurnContent(run(over)) });
const finished = { status: "succeeded", finishedAt: "2026-10-25T22:35:00Z", summary: "all green", output: "ok" } as const;

describe("planConflictRetry", () => {
  const head = [u("check the stack"), a("sure")];

  it("retries as an append when the server only added the run turn", () => {
    const server = [...head, runTurn(finished)];
    const local = [...head, u("and the disks?")];
    expect(planConflictRetry(server, local, 2, false)).toEqual({ kind: "retry", turns: [...server, u("and the disks?")] });
  });

  it("drops the local copy of a run turn the server has, matched by run id, and keeps the server's", () => {
    const server = [...head, runTurn(finished)];
    const local = [...head, runTurn({ status: "running" }), u("and the disks?")];
    expect(planConflictRetry(server, local, 3, false)).toEqual({ kind: "retry", turns: [...server, u("and the disks?")] });
  });

  it("adopts the server's copy, with no retry, when nothing local is left to add", () => {
    const server = [...head, runTurn(finished)];
    expect(planConflictRetry(server, [...head, runTurn({ status: "running" })], 3, false)).toEqual({ kind: "adopt" });
  });

  it("keeps a local run turn the server does not have", () => {
    const server = [...head, u("added elsewhere")];
    const local = [...head, runTurn({ status: "running" })];
    expect(planConflictRetry(server, local, 2, false)).toEqual({ kind: "retry", turns: [...server, local[2]] });
  });

  it("is a conflict when a turn the panel already had was changed on the server", () => {
    const server = [u("check the stack, reworded"), a("sure")];
    expect(planConflictRetry(server, [...head, u("more")], 2, false)).toEqual({ kind: "conflict" });
  });

  it("is a conflict when the panel's synced turns are missing from the server", () => {
    expect(planConflictRetry([head[0]], [...head, u("more")], 2, false)).toEqual({ kind: "conflict" });
  });

  it("never retries an edit or delete of history", () => {
    const server = [...head, runTurn(finished)];
    expect(planConflictRetry(server, [...head, u("x")], 2, true)).toEqual({ kind: "conflict" });
  });
});

describe("dedupeRunTurns", () => {
  it("keeps one turn per run id, in the first one's place, with the most finished text", () => {
    const turns = [u("q"), runTurn({ status: "running" }), a("ok"), runTurn(finished), runTurn({ id: "run-2" })];
    const out = dedupeRunTurns(turns);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual(runTurn(finished));
    expect(out[3]).toEqual(runTurn({ id: "run-2" }));
  });

  it("returns the same array when there is nothing to remove", () => {
    const turns = [u("q"), runTurn(), a("a")];
    expect(dedupeRunTurns(turns)).toBe(turns);
  });
});
