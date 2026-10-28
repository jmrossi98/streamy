import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  userId: string;
  title: string;
  titleEdited: boolean;
  backend: string;
  turns: string;
  turnCount: number;
  version: number;
  claudeSessionId: string | null;
  updatedAt: Date;
  lastPromptAt?: Date | null;
};

const rows = new Map<string, Row>();

vi.mock("../db", () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const r = rows.get(where.id);
        return r && r.userId === where.userId ? { ...r } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string; version?: number }; data: Partial<Row> & { version?: { increment: number } } }) => {
        const r = rows.get(where.id)!;
        if (where.version !== undefined && where.version !== r.version) throw Object.assign(new Error("not found"), { code: "P2025" });
        const next = { ...r, ...data, version: r.version + (data.version?.increment ?? 0), updatedAt: new Date() };
        rows.set(r.id, next);
        return { ...next };
      }),
    },
  },
}));
vi.mock("../auditLog", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../chatExport", () => ({ scheduleChatExport: vi.fn() }));
vi.mock("../chatAttachments", () => ({ syncSessionAttachments: vi.fn(async () => undefined) }));

import { logAudit } from "../auditLog";
import { ChatConflictError, applyRunTurn, updateChatSession } from "../chatSessions";
import { parseStoredTurns, titleFromTurns, type ChatTurn } from "../chatSessionRules";
import { findRunTurn, parseRunTurn, runTurnContent, type SkillRun } from "../skillRunnerRules";

const u = (content: string): ChatTurn => ({ role: "user", content });
const a = (content: string): ChatTurn => ({ role: "assistant", content });

function seed(id: string, turns: ChatTurn[], over: Partial<Row> = {}) {
  rows.set(id, {
    id,
    userId: "admin",
    title: titleFromTurns(turns),
    titleEdited: false,
    backend: "local",
    turns: JSON.stringify(turns),
    turnCount: turns.length,
    version: 0,
    claudeSessionId: null,
    updatedAt: new Date("2026-10-25T22:00:00Z"),
    ...over,
  });
}

const stored = (id: string) => parseStoredTurns(rows.get(id)!.turns);

const run = (over: Partial<SkillRun>): SkillRun => ({
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

beforeEach(() => {
  rows.clear();
  vi.mocked(logAudit).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("skill-run delivery is scoped to the chat the run came from", () => {
  it("lands a report only in chat A when chat B is the one open", async () => {
    const aTurns = [u("check the stack"), a("sure"), u("MEDIABOX SKILL RUN run-1 health-sweep running\nArgs: (none)")];
    aTurns[2] = { role: "user", via: "skill-run", content: aTurns[2].content };
    const bTurns = [u("something else entirely"), a("ok"), u("and more")];
    seed("A", aTurns);
    seed("B", bTurns);
    const bBefore = JSON.stringify(rows.get("B"));

    const done = run({ status: "succeeded", finishedAt: "2026-10-25T22:35:00Z", summary: "all green", output: "ok" });
    const session = await applyRunTurn("admin", "A", done);

    expect(session?.id).toBe("A");
    const a2 = stored("A");
    expect(a2).toHaveLength(3);
    expect(a2.slice(0, 2)).toEqual(aTurns.slice(0, 2));
    expect(parseRunTurn(a2[2].content)).toMatchObject({ id: "run-1", status: "succeeded", summary: "all green" });
    expect(rows.get("A")!.title).toBe("check the stack");
    // B is not touched at all.
    expect(JSON.stringify(rows.get("B"))).toBe(bBefore);
  });

  it("adds the turn for a queued run, then rewrites that same turn when it starts", async () => {
    seed("A", [u("q"), a("a")]);
    await applyRunTurn("admin", "A", run({ status: "queued", startedAt: null }));
    expect(stored("A")).toHaveLength(3);
    await applyRunTurn("admin", "A", run({ status: "running" }));
    const turns = stored("A");
    expect(turns).toHaveLength(3);
    expect(findRunTurn(turns, "run-1")).toBe(2);
    expect(parseRunTurn(turns[2].content)?.status).toBe("running");
    expect(turns.slice(0, 2)).toEqual([u("q"), a("a")]);
  });

  it("does not deliver into a chat that is not the caller's", async () => {
    seed("A", [u("q")], { userId: "someone-else" });
    expect(await applyRunTurn("admin", "A", run({}))).toBeNull();
    expect(stored("A")).toEqual([u("q")]);
  });
});

describe("a run turn and the panel's own copy of it", () => {
  const runCount = (turns: ChatTurn[], id = "run-1") => turns.filter((t) => t.via === "skill-run" && parseRunTurn(t.content)?.id === id).length;
  const runTurn = (over: Partial<SkillRun>): ChatTurn => ({ role: "user", via: "skill-run", content: runTurnContent(run(over)) });
  const done = { status: "succeeded", finishedAt: "2026-10-25T22:35:00Z", summary: "all green", output: "ok" } as const;
  const base = [u("check the stack"), a("sure")];

  it("(a) keeps the panel's pending turns when the server appended the run turn meanwhile", async () => {
    seed("A", base);
    await applyRunTurn("admin", "A", run({ status: "queued", startedAt: null }));
    const s = await updateChatSession("admin", "A", { turns: [...base, u("and the disks?")], baseTurnCount: 2 });
    expect(s?.turns.map((t) => t.content)).toEqual(["check the stack", "sure", runTurnContent(run({ status: "queued", startedAt: null })), "and the disks?"]);
  });

  it("(b) accepts a save whose copy of the run turn is older than the server's, keeping the server's", async () => {
    seed("A", base);
    await applyRunTurn("admin", "A", run({ status: "running" }));
    const stale = [...base, runTurn({ status: "running" })];
    await applyRunTurn("admin", "A", run(done));
    const s = await updateChatSession("admin", "A", { turns: [...stale, u("and the disks?")], baseTurnCount: 3 });
    expect(s?.turns).toHaveLength(4);
    expect(parseRunTurn(s!.turns[2].content)).toMatchObject({ id: "run-1", status: "succeeded", summary: "all green" });
    expect(s!.turns[3].content).toBe("and the disks?");
  });

  it("(b) does not store a second run turn when the panel added its own copy of one the server has", async () => {
    seed("A", base);
    await applyRunTurn("admin", "A", run(done));
    const s = await updateChatSession("admin", "A", { turns: [...base, runTurn({ status: "running" }), u("next")], baseTurnCount: 2 });
    expect(runCount(s!.turns)).toBe(1);
    expect(parseRunTurn(s!.turns[2].content)?.status).toBe("succeeded");
    expect(s!.turns.map((t) => t.content).slice(-1)).toEqual(["next"]);
  });

  it("dedupes run turns already doubled in a stored chat when it is read", async () => {
    seed("A", [...base, runTurn({ status: "running" }), u("hm"), runTurn(done)]);
    const s = await applyRunTurn("admin", "A", run({ id: "run-2", status: "queued", startedAt: null }));
    expect(runCount(s!.turns)).toBe(1);
    expect(runCount(s!.turns, "run-2")).toBe(1);
    expect(runCount(stored("A"))).toBe(1);
    expect(parseRunTurn(stored("A")[2].content)?.status).toBe("succeeded");
  });

  it("still refuses an edit of an ordinary turn as a non-append", async () => {
    seed("A", [...base, runTurn(done)]);
    await expect(
      updateChatSession("admin", "A", { turns: [u("check, reworded"), a("sure"), runTurn(done), u("x")], baseTurnCount: 3 })
    ).rejects.toBeInstanceOf(ChatConflictError);
  });
});

describe("the save endpoint refuses a non-append overwrite", () => {
  const aTurns = [u("question for A"), a("answer for A")];
  const bTurns = [u("a different chat"), a("its answer"), u("and a follow-up")];

  it("409s when another chat's transcript is sent to this one, and logs it", async () => {
    seed("A", aTurns);
    await expect(updateChatSession("admin", "A", { turns: bTurns, baseTurnCount: 2 })).rejects.toBeInstanceOf(ChatConflictError);
    expect(stored("A")).toEqual(aTurns);
    expect(rows.get("A")!.title).toBe("question for A");
    expect(console.warn).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith("admin", "assistant.chat.save.refused", "A", expect.stringContaining("not-append"));
  });

  it("refuses it with no base too (an older panel)", async () => {
    seed("A", aTurns);
    await expect(updateChatSession("admin", "A", { turns: bTurns })).rejects.toBeInstanceOf(ChatConflictError);
    expect(stored("A")).toEqual(aTurns);
  });

  it("refuses a save that carries a title along with the transcript", async () => {
    seed("A", aTurns);
    await expect(updateChatSession("admin", "A", { turns: [...aTurns, u("more")], title: "Hijacked" })).rejects.toBeInstanceOf(
      ChatConflictError
    );
    expect(rows.get("A")!.title).toBe("question for A");
  });

  it("accepts a plain append", async () => {
    seed("A", aTurns);
    const s = await updateChatSession("admin", "A", { turns: [...aTurns, u("next")], baseTurnCount: 2 });
    expect(s?.turns).toHaveLength(3);
    expect(s?.title).toBe("question for A");
  });

  it("keeps turns added elsewhere and appends the panel's after them", async () => {
    seed("A", [...aTurns, { role: "user", via: "claude-code", content: "cc" }]);
    const s = await updateChatSession("admin", "A", { turns: [...aTurns, u("mine")], baseTurnCount: 2 });
    expect(s?.turns.map((t) => t.content)).toEqual(["question for A", "answer for A", "cc", "mine"]);
  });

  it("allows an edit of history only when the panel says replace", async () => {
    seed("A", aTurns);
    const edited = [u("question for A, reworded"), a("answer for A")];
    await expect(updateChatSession("admin", "A", { turns: edited, baseTurnCount: 2 })).rejects.toBeInstanceOf(ChatConflictError);
    const s = await updateChatSession("admin", "A", { turns: edited, baseTurnCount: 2, replace: true });
    expect(s?.turns[0].content).toBe("question for A, reworded");
  });

  it("409s a stale version, leaves the chat as stored, and bumps the version on a good write", async () => {
    seed("A", aTurns, { version: 3 });
    await expect(updateChatSession("admin", "A", { turns: [...aTurns, u("x")], baseTurnCount: 2, baseVersion: 2 })).rejects.toBeInstanceOf(
      ChatConflictError
    );
    expect(stored("A")).toEqual(aTurns);
    expect(logAudit).toHaveBeenCalledWith("admin", "assistant.chat.save.refused", "A", expect.stringContaining("stale-version"));
    const s = await updateChatSession("admin", "A", { turns: [...aTurns, u("x")], baseTurnCount: 2, baseVersion: 3 });
    expect(s?.turns).toHaveLength(3);
    expect(rows.get("A")!.version).toBe(4);
  });

  it("409s when the row changes between the read and the write (compare-and-swap)", async () => {
    seed("A", aTurns, { version: 1 });
    const { prisma } = await import("../db");
    vi.mocked(prisma.chatSession.findFirst).mockImplementationOnce((async () => {
      const copy = { ...rows.get("A")! };
      rows.set("A", { ...copy, version: 2 });
      return copy;
    }) as never);
    await expect(updateChatSession("admin", "A", { turns: [...aTurns, u("x")], baseTurnCount: 2 })).rejects.toBeInstanceOf(ChatConflictError);
    expect(stored("A")).toEqual(aTurns);
  });

  it("refuses replace with no baseTurnCount, or one that is not the stored count", async () => {
    seed("A", aTurns);
    const edited = [u("question for A, reworded"), a("answer for A")];
    await expect(updateChatSession("admin", "A", { turns: edited, replace: true })).rejects.toBeInstanceOf(ChatConflictError);
    await expect(updateChatSession("admin", "A", { turns: edited, replace: true, baseTurnCount: 1 })).rejects.toBeInstanceOf(ChatConflictError);
    await expect(updateChatSession("admin", "A", { turns: edited, replace: true, baseTurnCount: 3 })).rejects.toBeInstanceOf(ChatConflictError);
    expect(stored("A")).toEqual(aTurns);
    expect(logAudit).toHaveBeenCalledWith("admin", "assistant.chat.save.refused", "A", expect.stringContaining("replace-without-base"));
  });

  it("accepts a replace with the stored count, and an append without a version", async () => {
    seed("A", aTurns);
    const edited = [u("question for A, reworded"), a("answer for A")];
    const s = await updateChatSession("admin", "A", { turns: edited, replace: true, baseTurnCount: 2, baseVersion: 0 });
    expect(s?.turns[0].content).toBe("question for A, reworded");
    const appended = await updateChatSession("admin", "A", { turns: [...edited, u("more")], baseTurnCount: 2 });
    expect(appended?.turns).toHaveLength(3);
  });

  it("still renames on its own", async () => {
    seed("A", aTurns);
    const s = await updateChatSession("admin", "A", { title: "My name" });
    expect(s?.title).toBe("My name");
    expect(stored("A")).toEqual(aTurns);
  });
});

describe("lastPromptAt orders the list", () => {
  const at = new Date("2026-10-25T22:00:00Z");

  it("moves on a new prompt but not on a rename, a backend change or a run report", async () => {
    seed("A", [u("hi"), a("hello")], { lastPromptAt: at });
    await updateChatSession("admin", "A", { title: "renamed" });
    await updateChatSession("admin", "A", { backend: "claude" });
    await updateChatSession("admin", "A", { turns: [u("hi"), a("hello"), { role: "user", via: "skill-run", content: "RUN" }], baseTurnCount: 2 });
    expect(rows.get("A")!.lastPromptAt).toEqual(at);
    await updateChatSession("admin", "A", { turns: [...stored("A"), u("again")], baseTurnCount: 3 });
    expect(rows.get("A")!.lastPromptAt!.getTime()).toBeGreaterThan(at.getTime());
  });
});
