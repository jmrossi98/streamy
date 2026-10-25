import { describe, expect, it } from "vitest";
import { buildRunTurnRequest, buildSaveRequest, createSaveQueue } from "../chatSaver";
import type { ChatTurn } from "../chatSessionRules";

const u = (content: string): ChatTurn => ({ role: "user", content });

/**
 * The panel's persist(), reduced to what matters here: a save is built from
 * the chat id captured when it was started, and goes through the queue.
 */
function makePanel() {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const gates: (() => void)[] = [];
  const queue = createSaveQueue();
  const panel = {
    currentId: "A" as string | null,
    synced: 2,
    calls,
    save(turns: ChatTurn[], chatId: string | null, replace = false) {
      return queue.enqueue(async () => {
        const req = buildSaveRequest(chatId, turns, "local", {
          base: chatId !== null && chatId === panel.currentId ? panel.synced : null,
          replace,
        });
        // The request is in flight until the test lets it land.
        await new Promise<void>((resolve) => gates.push(resolve));
        calls.push({ url: req.url, method: req.method, body: JSON.parse(req.body) });
      });
    },
    /** What openSession does: wait for pending saves, then switch. */
    async switchTo(id: string | null) {
      await queue.flush();
      panel.currentId = id;
    },
    /** Lets the oldest in-flight request land (after the queue has started it). */
    async release() {
      await new Promise((r) => setTimeout(r, 0));
      gates.shift()?.();
    },
  };
  return panel;
}

describe("a save goes to the chat it was started for", () => {
  it("writes to the original chat only when the user switches with a save pending", async () => {
    const p = makePanel();
    const saving = p.save([u("q1"), u("q2"), u("q3")], "A");
    const switching = p.switchTo("B");

    // The switch is waiting for the save, so B is not open yet.
    await Promise.resolve();
    expect(p.currentId).toBe("A");

    await p.release();
    await saving;
    await switching;
    expect(p.currentId).toBe("B");

    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].url).toBe("/api/admin/chat-sessions/A");
    expect(p.calls[0].body.baseTurnCount).toBe(2);
  });

  it("still writes to A when a save for A is built after B became the open chat", async () => {
    const p = makePanel();
    p.currentId = "B";
    const saving = p.save([u("a1")], "A");
    await p.release();
    await saving;
    expect(p.calls.map((c) => c.url)).toEqual(["/api/admin/chat-sessions/A"]);
    // B's sync point is not A's: no base is sent, so the server checks the whole prefix.
    expect(p.calls[0].body).not.toHaveProperty("baseTurnCount");
  });

  it("runs saves in order, one at a time", async () => {
    const p = makePanel();
    const first = p.save([u("1")], "A");
    const second = p.save([u("1"), u("2")], "A");
    await Promise.resolve();
    await p.release();
    await first;
    expect(p.calls).toHaveLength(1);
    await p.release();
    await second;
    expect(p.calls.map((c) => (c.body.turns as unknown[]).length)).toEqual([1, 2]);
  });

  it("keeps going after a save fails", async () => {
    const queue = createSaveQueue();
    await expect(queue.enqueue(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(queue.enqueue(async () => "ok")).resolves.toBe("ok");
    await queue.flush();
  });

  it("creates a chat only for a null id, and flags replace only when asked", () => {
    expect(buildSaveRequest(null, [u("x")], "local", { base: null, replace: false })).toMatchObject({
      url: "/api/admin/chat-sessions",
      method: "POST",
    });
    const edit = buildSaveRequest("A", [u("x")], "local", { base: 1, replace: true });
    expect(JSON.parse(edit.body)).toMatchObject({ replace: true, baseTurnCount: 1 });
    expect(JSON.parse(buildSaveRequest("A", [u("x")], "local", { base: 1, replace: false }).body)).not.toHaveProperty("replace");
  });

  it("sends only the run id for a run turn", () => {
    const req = buildRunTurnRequest("A", "run-1");
    expect(req.url).toBe("/api/admin/chat-sessions/A/run-turn");
    expect(JSON.parse(req.body)).toEqual({ runId: "run-1" });
  });
});
