/**
 * The admin chat's send queue: messages typed while a reply is still
 * streaming wait here, one first-in-first-out line per conversation, and go out
 * one at a time when the reply before them succeeds. Pure and in memory only --
 * the panel owns when to call these.
 *
 * Everything is immutable: each function returns the next state.
 */

/** How many messages may wait in one conversation. */
export const QUEUE_MAX = 5;

/** The key of the chat that has no id yet (a new chat before its first save). */
export const NEW_CHAT_KEY = "";

type Base = {
  id: string;
  /** The backend and model the admin had chosen when this was queued; it goes out on those. */
  backend: string;
  model: string;
};

export type QueuedMessage = Base & { kind: "message"; text: string };
/** A skill run that ended during a reply: the model reads its result once the line reaches it. */
export type QueuedRun = Base & { kind: "run"; runId: string };
export type QueueItem = QueuedMessage | QueuedRun;

export type ChatQueue = { items: QueueItem[]; paused: boolean };

/** Conversation key -> its line. A conversation with nothing waiting has no entry. */
export type Queues = Readonly<Record<string, ChatQueue>>;

export const EMPTY_QUEUES: Queues = {};

const EMPTY: ChatQueue = { items: [], paused: false };

/** The line for `key` (empty and not paused when there is none). */
export function queueOf(queues: Queues, key: string): ChatQueue {
  return queues[key] ?? EMPTY;
}

function put(queues: Queues, key: string, q: ChatQueue): Queues {
  // Nothing left waiting also clears a pause: it was about the items.
  if (q.items.length === 0) {
    if (!(key in queues)) return queues;
    const { [key]: _gone, ...rest } = queues;
    return rest;
  }
  return { ...queues, [key]: q };
}

export type EnqueueResult = { queues: Queues; ok: boolean };

/**
 * Adds `item` to the back of `key`'s line. Refused (ok false, nothing changed)
 * when the line already holds QUEUE_MAX. A run already waiting is not added
 * twice, and that counts as ok.
 */
export function enqueue(queues: Queues, key: string, item: QueueItem): EnqueueResult {
  const q = queueOf(queues, key);
  if (item.kind === "run" && q.items.some((x) => x.kind === "run" && x.runId === item.runId)) {
    return { queues, ok: true };
  }
  if (q.items.length >= QUEUE_MAX) return { queues, ok: false };
  return { queues: put(queues, key, { ...q, items: [...q.items, item] }), ok: true };
}

/** The item that goes next, or null when the line is empty or paused. */
export function peek(queues: Queues, key: string): QueueItem | null {
  const q = queueOf(queues, key);
  return q.paused ? null : (q.items[0] ?? null);
}

/** Takes the front item off the line; item is null when the line is empty or paused. */
export function dequeue(queues: Queues, key: string): { queues: Queues; item: QueueItem | null } {
  const item = peek(queues, key);
  if (!item) return { queues, item: null };
  const q = queueOf(queues, key);
  return { queues: put(queues, key, { ...q, items: q.items.slice(1) }), item };
}

/** Holds the line (a reply failed or was stopped). A line with nothing in it has nothing to hold. */
export function pause(queues: Queues, key: string): Queues {
  const q = queueOf(queues, key);
  if (q.items.length === 0 || q.paused) return queues;
  return put(queues, key, { ...q, paused: true });
}

/** Lets the line go again. */
export function resume(queues: Queues, key: string): Queues {
  const q = queueOf(queues, key);
  if (!q.paused) return queues;
  return put(queues, key, { ...q, paused: false });
}

/** Drops everything waiting in `key`, and the pause with it. */
export function clear(queues: Queues, key: string): Queues {
  return put(queues, key, EMPTY);
}

/** Drops one waiting item. */
export function remove(queues: Queues, key: string, id: string): Queues {
  const q = queueOf(queues, key);
  const items = q.items.filter((x) => x.id !== id);
  if (items.length === q.items.length) return queues;
  return put(queues, key, { ...q, items });
}

/**
 * A new chat got its id: what was waiting under `from` now waits under `to`,
 * ahead of nothing (`to` is a fresh id, so it has no line of its own yet).
 */
export function rekey(queues: Queues, from: string, to: string): Queues {
  if (from === to || !(from in queues)) return queues;
  const { [from]: moved, ...rest } = queues;
  return put(rest, to, moved);
}
