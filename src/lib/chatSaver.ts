/**
 * How the chat panel writes a chat to the server, kept out of the component so
 * it tests without a browser.
 *
 * Two rules, from 2026-10-25 when one chat's whole transcript and title landed
 * in another chat's record: a save goes to the chat id it was *started* for
 * (never to whichever chat is open when the request is built or sent), and
 * saves run one at a time, so switching chats can wait for the pending ones.
 */

import { runIdOf, sameTurn, type ChatTurn } from "./chatSessionRules";

/** Runs tasks strictly in order. `flush` resolves once everything queued so far has settled. */
export function createSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task, task);
      tail = run.catch(() => undefined);
      return run;
    },
    async flush(): Promise<void> {
      await tail;
    },
  };
}

export type SaveRequest = { url: string; method: "PATCH" | "POST"; body: string };

/**
 * The request for saving `turns` to chat `chatId` (null: create one). Built only
 * from what is passed in -- `base` is the turn count the panel last synced for
 * *that* chat, or null when it is not the open one.
 */
export function buildSaveRequest(
  chatId: string | null,
  turns: ChatTurn[],
  backend: string,
  opts: { base: number | null; replace: boolean }
): SaveRequest {
  if (!chatId) return { url: "/api/admin/chat-sessions", method: "POST", body: JSON.stringify({ turns, backend }) };
  return {
    url: `/api/admin/chat-sessions/${encodeURIComponent(chatId)}`,
    method: "PATCH",
    body: JSON.stringify({
      turns,
      backend,
      ...(opts.base !== null ? { baseTurnCount: opts.base } : {}),
      ...(opts.replace ? { replace: true } : {}),
    }),
  };
}

export type ConflictPlan =
  /** Save `turns` (the server's transcript plus what the panel added) as a plain append. */
  | { kind: "retry"; turns: ChatTurn[] }
  /** The server already has everything the panel meant to add: take its copy. */
  | { kind: "adopt" }
  /** The panel's changes really collide with the server's: take the server's copy and say so. */
  | { kind: "conflict" };

/**
 * What to do after the server refused a save with 409. `server` is its copy of
 * the chat now, `local` what the panel tried to save, `base` how many turns the
 * panel had last received. Local copies of run turns the server holds are
 * dropped (matched by run id: the server rewrites those in place, so a local
 * copy is only ever older). If what is left is the turns the panel already had,
 * still in agreement with the server, plus new ones, the new ones go on after
 * the server's transcript. An edit or delete of history (`replace`) is never
 * replayed: it was made against turns that have changed.
 */
export function planConflictRetry(server: ChatTurn[], local: ChatTurn[], base: number, replace: boolean): ConflictPlan {
  if (replace || base > local.length) return { kind: "conflict" };
  const serverIds = new Set(server.map(runIdOf).filter((id): id is string => id !== null));
  const shared = new Set(local.map(runIdOf).filter((id): id is string => id !== null && serverIds.has(id)));
  const mine = (t: ChatTurn) => shared.has(runIdOf(t) ?? "");
  const synced = local.slice(0, base).filter((t) => !mine(t));
  const added = local.slice(base).filter((t) => !mine(t));
  const theirs = server.filter((t) => !mine(t));
  if (synced.length > theirs.length || synced.some((t, i) => !sameTurn(t, theirs[i]))) return { kind: "conflict" };
  return added.length === 0 ? { kind: "adopt" } : { kind: "retry", turns: [...server, ...added] };
}

/**
 * The request that puts one run's turn into chat `chatId`, server-side. With
 * `proposal` (turn index and block index of the card whose Run was tapped) the
 * server also links that proposal to the run.
 */
export function buildRunTurnRequest(chatId: string, runId: string, proposal?: { turn: number; block: number }): SaveRequest {
  return {
    url: `/api/admin/chat-sessions/${encodeURIComponent(chatId)}/run-turn`,
    method: "POST",
    body: JSON.stringify(proposal ? { runId, proposal } : { runId }),
  };
}
