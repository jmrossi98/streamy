import { describe, expect, it } from "vitest";
import {
  EMPTY_QUEUES,
  NEW_CHAT_KEY,
  QUEUE_MAX,
  clear,
  dequeue,
  enqueue,
  pause,
  peek,
  queueOf,
  remove,
  rekey,
  resume,
  type QueueItem,
  type Queues,
} from "./sendQueue";

const msg = (id: string, text = id): QueueItem => ({ id, kind: "message", text, backend: "local", model: "m" });
const run = (id: string, runId: string): QueueItem => ({ id, kind: "run", runId, backend: "local", model: "m" });

function fill(key: string, n: number): Queues {
  let q: Queues = EMPTY_QUEUES;
  for (let i = 0; i < n; i++) q = enqueue(q, key, msg(`m${i}`)).queues;
  return q;
}

describe("enqueue", () => {
  it("holds up to the cap and refuses the next without changing anything", () => {
    const full = fill("a", QUEUE_MAX);
    expect(queueOf(full, "a").items).toHaveLength(QUEUE_MAX);
    const over = enqueue(full, "a", msg("extra"));
    expect(over.ok).toBe(false);
    expect(over.queues).toBe(full);
  });
  it("does not queue the same run twice", () => {
    const once = enqueue(EMPTY_QUEUES, "a", run("1", "r1")).queues;
    const twice = enqueue(once, "a", run("2", "r1"));
    expect(twice.ok).toBe(true);
    expect(queueOf(twice.queues, "a").items).toHaveLength(1);
  });
  it("does not queue a second retry, even on another model", () => {
    const retry = (id: string, model: string): QueueItem => ({ id, kind: "retry", backend: "local", model });
    const once = enqueue(EMPTY_QUEUES, "a", retry("1", "m")).queues;
    const twice = enqueue(once, "a", retry("2", "other"));
    expect(twice.ok).toBe(true);
    expect(twice.queues).toBe(once);
    expect(queueOf(twice.queues, "a").items).toHaveLength(1);
  });
  it("refuses a retry on a full line like any other item", () => {
    const retry: QueueItem = { id: "r", kind: "retry", backend: "local", model: "m" };
    const full = fill("a", QUEUE_MAX);
    expect(enqueue(full, "a", retry).ok).toBe(false);
  });
  it("keeps the backend and model it was queued with", () => {
    const item: QueueItem = { id: "x", kind: "message", text: "hi", backend: "claude", model: "opus" };
    const q = enqueue(EMPTY_QUEUES, "a", item).queues;
    expect(peek(q, "a")).toMatchObject({ backend: "claude", model: "opus" });
  });
});

describe("dequeue", () => {
  it("goes first in, first out", () => {
    let q = fill("a", 3);
    const order: string[] = [];
    for (;;) {
      const next = dequeue(q, "a");
      if (!next.item) break;
      order.push(next.item.id);
      q = next.queues;
    }
    expect(order).toEqual(["m0", "m1", "m2"]);
    expect(q).toEqual({});
  });
  it("gives nothing from an empty line", () => {
    expect(dequeue(EMPTY_QUEUES, "a").item).toBeNull();
  });
});

describe("pause and resume", () => {
  it("holds the line until resumed", () => {
    const paused = pause(fill("a", 2), "a");
    expect(queueOf(paused, "a").paused).toBe(true);
    expect(peek(paused, "a")).toBeNull();
    expect(dequeue(paused, "a").item).toBeNull();
    const resumed = resume(paused, "a");
    expect(dequeue(resumed, "a").item?.id).toBe("m0");
  });
  it("has nothing to hold on an empty line", () => {
    expect(pause(EMPTY_QUEUES, "a")).toBe(EMPTY_QUEUES);
  });
  it("lets items be added while paused, still held", () => {
    const q = enqueue(pause(fill("a", 1), "a"), "a", msg("late")).queues;
    expect(queueOf(q, "a")).toMatchObject({ paused: true });
    expect(queueOf(q, "a").items).toHaveLength(2);
    expect(peek(q, "a")).toBeNull();
  });
  it("drops the pause when the last item goes", () => {
    const paused = pause(fill("a", 1), "a");
    const emptied = remove(paused, "a", "m0");
    expect(queueOf(emptied, "a")).toEqual({ items: [], paused: false });
    expect(peek(enqueue(emptied, "a", msg("new")).queues, "a")?.id).toBe("new");
  });
});

describe("clear and remove", () => {
  it("clear empties the line and its pause", () => {
    const q = clear(pause(fill("a", 3), "a"), "a");
    expect(queueOf(q, "a")).toEqual({ items: [], paused: false });
  });
  it("remove drops just that item and keeps order", () => {
    const q = remove(fill("a", 3), "a", "m1");
    expect(queueOf(q, "a").items.map((x) => x.id)).toEqual(["m0", "m2"]);
  });
  it("remove of an unknown id changes nothing", () => {
    const q = fill("a", 2);
    expect(remove(q, "a", "nope")).toBe(q);
  });
});

describe("per conversation", () => {
  it("keeps one line per chat, each with its own cap and pause", () => {
    let q = fill("a", QUEUE_MAX);
    q = enqueue(q, "b", msg("b0")).queues;
    expect(enqueue(q, "b", msg("b1")).ok).toBe(true);
    q = pause(q, "a");
    expect(peek(q, "a")).toBeNull();
    expect(peek(q, "b")?.id).toBe("b0");
    q = clear(q, "a");
    expect(queueOf(q, "b").items).toHaveLength(1);
  });
  it("moves a new chat's line to its id once it has one", () => {
    const q = rekey(pause(fill(NEW_CHAT_KEY, 2), NEW_CHAT_KEY), NEW_CHAT_KEY, "chat-1");
    expect(queueOf(q, NEW_CHAT_KEY).items).toHaveLength(0);
    expect(queueOf(q, "chat-1")).toMatchObject({ paused: true });
    expect(queueOf(q, "chat-1").items.map((x) => x.id)).toEqual(["m0", "m1"]);
  });
});
