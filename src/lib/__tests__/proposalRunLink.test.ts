import { describe, expect, it, vi } from "vitest";
import {
  createStartGuard,
  linkedRunId,
  normalizeProposalRuns,
  PROPOSAL_BLOCK,
  proposalRunView,
  runCardInThread,
  runTurnContent,
  type SkillRun,
} from "../skillRunnerRules";
import { checkTranscriptSave, normalizeTurns, withProposalRun, type ChatTurn } from "../chatSessionRules";
import { buildRunTurnRequest } from "../chatSaver";

const proposalText =
  "ESPN looks dead.\n```propose_mediabox_skill\n" +
  '{"skill": "ship-fix", "args": {"repo": "streamy", "task": "x"}, "reason": "fix it"}\n```';

const chat: ChatTurn[] = [
  { role: "user", content: "fix the card" },
  { role: "assistant", content: proposalText },
];

const run = (over: Partial<SkillRun> = {}): SkillRun => ({
  id: "r1",
  skill: "ship-fix",
  args: {},
  requestedBy: "jaker",
  status: "queued",
  startedAt: null,
  finishedAt: null,
  output: "",
  summary: null,
  links: [],
  ...over,
});

describe("the proposal-to-run link", () => {
  it("shows Queued, #N after the tap: the link exists and the run is queued", () => {
    const linked = withProposalRun(chat, 1, PROPOSAL_BLOCK, "ship-fix", "r1");
    expect(linkedRunId(linked[1])).toBe("r1");
    expect(proposalRunView(run({ position: 2 }))).toEqual({ kind: "queued", label: "Queued, #2" });
  });

  it("survives a reload and a new message being appended", () => {
    const linked = withProposalRun(chat, 1, PROPOSAL_BLOCK, "ship-fix", "r1");
    const reloaded = normalizeTurns(JSON.parse(JSON.stringify(linked)));
    expect(linkedRunId(reloaded[1])).toBe("r1");
    const appended = [...reloaded, { role: "user" as const, content: "thanks" }, { role: "assistant" as const, content: "welcome" }];
    expect(linkedRunId(appended[1])).toBe("r1");
    expect(linkedRunId(appended[3])).toBeNull();
  });

  it("is not lost when a panel copy that predates the link saves an appended message", () => {
    const stored = withProposalRun(chat, 1, PROPOSAL_BLOCK, "ship-fix", "r1");
    const stale: ChatTurn[] = [...chat, { role: "user", content: "and then?" }];
    const saved = checkTranscriptSave(stored, stale, 2, false);
    expect(saved.ok && linkedRunId(saved.turns[1])).toBe("r1");
  });

  it("only links a real proposal for that skill, once", () => {
    expect(withProposalRun(chat, 0, 0, "ship-fix", "r1")).toBe(chat);
    expect(withProposalRun(chat, 1, 0, "health-sweep", "r1")).toBe(chat);
    expect(withProposalRun(chat, 7, 0, "ship-fix", "r1")).toBe(chat);
    const linked = withProposalRun(chat, 1, 0, "ship-fix", "r1");
    expect(withProposalRun(linked, 1, 0, "ship-fix", "r2")).toBe(linked);
  });

  it("drops junk links when reading a stored chat", () => {
    expect(normalizeProposalRuns({ "0": "r1", x: "r2", "1": "../etc" })).toEqual({ "0": "r1" });
    expect(normalizeProposalRuns([])).toBeNull();
    expect(normalizeTurns([{ role: "user", content: "hi", proposalRuns: { "0": "r1" } }])).toEqual([{ role: "user", content: "hi" }]);
  });

  it("sends the proposal reference with the run-turn request", () => {
    const req = buildRunTurnRequest("c1", "r1", { turn: 1, block: 0 });
    expect(JSON.parse(req.body)).toEqual({ runId: "r1", proposal: { turn: 1, block: 0 } });
    expect(JSON.parse(buildRunTurnRequest("c1", "r1").body)).toEqual({ runId: "r1" });
  });
});

describe("what the linked card shows", () => {
  it("shows no Run button state until polled: checking", () => {
    expect(proposalRunView(null)).toEqual({ kind: "checking" });
  });

  it("running shows elapsed time and last step", () => {
    const v = proposalRunView(
      run({ status: "running", startedAt: "t", heartbeat: { elapsedSeconds: 185, lastStep: "Run npx vitest", lastActivityAt: null } })
    );
    expect(v).toEqual({ kind: "running", label: "Running", heartbeat: "3m 05s · last step: Run npx vitest", waiting: false });
  });

  it("a finished run shows its final status and report link instead of Run", () => {
    const done = proposalRunView(run({ status: "succeeded", links: ["https://github.com/jmrossi98/streamy/pull/1"] }));
    expect(done).toEqual({ kind: "finished", label: "Succeeded", status: "succeeded", links: ["https://github.com/jmrossi98/streamy/pull/1"] });
    expect(proposalRunView(run({ status: "failed" }))).toMatchObject({ kind: "finished", label: "Failed" });
    expect(proposalRunView(run({ status: "cancelled" }))).toMatchObject({ kind: "finished", label: "Cancelled" });
  });
});

describe("a double tap", () => {
  it("sends one POST /runs, and both taps get the same answer", async () => {
    let release: (v: string) => void = () => {};
    const post = vi.fn(() => new Promise<string>((res) => (release = res)));
    const start = createStartGuard(post);
    const first = start();
    const second = start();
    release("r1");
    expect(await first).toBe("r1");
    expect(await second).toBe("r1");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("lets a retry through once the first request has failed", async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("r2");
    const start = createStartGuard(post);
    await expect(start()).rejects.toThrow("down");
    await expect(start()).resolves.toBe("r2");
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("one card per run id", () => {
  const linked = withProposalRun(chat, 1, PROPOSAL_BLOCK, "ship-fix", "r1");
  const runTurn = (id: string): ChatTurn => ({ role: "user", via: "skill-run", content: runTurnContent(run({ id, status: "running" })) });

  it("collapses the proposal's status when the run's own card is in the thread", () => {
    const turns = [...linked, runTurn("r1")];
    expect(runCardInThread(turns, turns[1])).toBe(true);
  });

  it("keeps the full status when no card for that run is in the thread", () => {
    expect(runCardInThread(linked, linked[1])).toBe(false);
    const other = [...linked, runTurn("r2")];
    expect(runCardInThread(other, other[1])).toBe(false);
  });

  it("is false for a proposal that was never run, and leaves the turn text alone", () => {
    const turns = [...chat, runTurn("r1")];
    const before = turns.map((t) => t.content);
    expect(runCardInThread(turns, turns[1])).toBe(false);
    expect(turns.map((t) => t.content)).toEqual(before);
  });
});
