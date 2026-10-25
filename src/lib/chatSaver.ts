/**
 * How the chat panel writes a chat to the server, kept out of the component so
 * it tests without a browser.
 *
 * Two rules, from 2026-10-25 when one chat's whole transcript and title landed
 * in another chat's record: a save goes to the chat id it was *started* for
 * (never to whichever chat is open when the request is built or sent), and
 * saves run one at a time, so switching chats can wait for the pending ones.
 */

import type { ChatTurn } from "./chatSessionRules";

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

/** The request that puts one run's turn into chat `chatId`, server-side. */
export function buildRunTurnRequest(chatId: string, runId: string): SaveRequest {
  return {
    url: `/api/admin/chat-sessions/${encodeURIComponent(chatId)}/run-turn`,
    method: "POST",
    body: JSON.stringify({ runId }),
  };
}
