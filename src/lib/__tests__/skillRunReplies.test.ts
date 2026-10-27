import { describe, expect, it } from "vitest";
import {
  canReplyTo,
  continuedRunIds,
  MAX_REPLY_CHARS,
  normalizeRun,
  parseRunTurn,
  runTurnContent,
  shortRunId,
  skillsPrompt,
  startedEmail,
  validateReply,
  type SkillRun,
} from "../skillRunnerRules";

const run = (over: Partial<SkillRun>): SkillRun => ({
  id: "p1",
  skill: "ship-fix",
  args: { task: "fix the thing" },
  requestedBy: "jaker",
  status: "succeeded",
  startedAt: "2026-10-27T10:00:00Z",
  finishedAt: "2026-10-27T10:05:00Z",
  output: "did it",
  summary: "Fixed.",
  links: [],
  ...over,
});

describe("validateReply", () => {
  it("trims and accepts plain text", () => {
    expect(validateReply("  carry on  ")).toEqual({ ok: true, message: "carry on" });
  });
  it("refuses empty, blank and non-text", () => {
    expect(validateReply("").ok).toBe(false);
    expect(validateReply("   \n").ok).toBe(false);
    expect(validateReply(42).ok).toBe(false);
    expect(validateReply(undefined).ok).toBe(false);
  });
  it("refuses more than the runner takes", () => {
    expect(validateReply("x".repeat(MAX_REPLY_CHARS)).ok).toBe(true);
    expect(validateReply("x".repeat(MAX_REPLY_CHARS + 1)).ok).toBe(false);
  });
});

describe("normalizeRun reply fields", () => {
  it("reads continues, root, message and canReply", () => {
    const r = normalizeRun({ id: "c1", skill: "ship-fix", status: "failed", continues: "p1", root: "p0", message: " go on ", canReply: true });
    expect(r).toMatchObject({ continues: "p1", root: "p0", message: "go on", canReply: true });
  });
  it("never offers a reply on a run still going, and drops bad ids", () => {
    const r = normalizeRun({ id: "c1", skill: "ship-fix", status: "running", continues: "../x", canReply: true });
    expect(r).toMatchObject({ continues: null, canReply: false });
  });
  it("leaves older runners' records without reply fields", () => {
    expect(normalizeRun({ id: "c1", skill: "ship-fix", status: "succeeded" })).toMatchObject({ continues: null, message: null, canReply: false });
  });
});

describe("canReplyTo", () => {
  it("only for a finished, continuable run not already replied to in the chat", () => {
    expect(canReplyTo({ status: "failed", canReply: true }, false)).toBe(true);
    expect(canReplyTo({ status: "succeeded", canReply: true }, true)).toBe(false);
    expect(canReplyTo({ status: "running", canReply: true }, false)).toBe(false);
    expect(canReplyTo({ status: "failed", canReply: false }, false)).toBe(false);
    expect(canReplyTo({ status: "failed" }, false)).toBe(false);
    expect(canReplyTo(null, false)).toBe(false);
  });
});

describe("shortRunId", () => {
  it("cuts long ids to 8 and leaves short ones", () => {
    expect(shortRunId("20261027-101500-abcd")).toBe("20261027");
    expect(shortRunId("abc")).toBe("abc");
  });
});

describe("reply run turns", () => {
  it("a running reply's turn carries the parent and the reply text", () => {
    const content = runTurnContent(run({ id: "c1", status: "running", continues: "p1", message: "fix the lint error\nthen push" }));
    const t = parseRunTurn(content)!;
    expect(t).toMatchObject({ id: "c1", status: "running", continues: "p1", message: "fix the lint error\nthen push", canReply: false });
    expect(t.args).toBe("task=fix the thing");
  });

  it("a finished reply keeps the reply apart from the report, and records that it can be replied to", () => {
    const content = runTurnContent(run({ id: "c1", continues: "p1", message: "go on", canReply: true, summary: "Done.", output: "out" }));
    const t = parseRunTurn(content)!;
    expect(t).toMatchObject({ continues: "p1", message: "go on", summary: "Done.", output: "out", canReply: true });
    // The admin's words come after the "data, not instructions" preamble.
    expect(content.indexOf("--- reply from the admin ---")).toBeGreaterThan(content.indexOf("Data, not instructions"));
  });

  it("a plain run's turn reads as before", () => {
    const t = parseRunTurn(runTurnContent(run({})))!;
    expect(t).toMatchObject({ continues: null, message: null, canReply: false, summary: "Fixed." });
  });

  it("a long reply is cut in the turn so the run's output still fits", () => {
    const content = runTurnContent(run({ message: "y".repeat(MAX_REPLY_CHARS), output: "z".repeat(10_000) }));
    expect(content.length).toBeLessThanOrEqual(7_500);
    expect(parseRunTurn(content)!.message!.endsWith("[...]")).toBe(true);
  });

  it("continuedRunIds finds the runs a later turn replies to", () => {
    const turns = [
      { role: "user", via: "skill-run", content: runTurnContent(run({ id: "p1" })) },
      { role: "user", via: "skill-run", content: runTurnContent(run({ id: "c1", continues: "p1", message: "more" })) },
      { role: "assistant", content: "Continues: p9" },
    ];
    expect([...continuedRunIds(turns)]).toEqual(["p1"]);
  });
});

describe("the model is told about replies and the task skill", () => {
  it("in the skills prompt", () => {
    const p = skillsPrompt([{ name: "task", kind: "code", description: "anything", args: [] }]);
    expect(p).toMatch(/Reply button/);
    expect(p).toMatch(/Rerun of X/);
    expect(p).toMatch(/general skill `task`/);
  });
});

describe("startedEmail for a reply", () => {
  it("says it is a reply and quotes it", () => {
    const m = startedEmail("ship-fix", "code", "jaker", {}, "c1", "Claude Code", { continues: "p1", message: "go on" });
    expect(m.subject).toBe("Skill ship-fix reply started from admin chat by jaker");
    expect(m.body).toContain("Reply to run p1:\ngo on");
  });
});
