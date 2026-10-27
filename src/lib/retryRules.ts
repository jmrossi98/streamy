/**
 * When the admin chat offers Retry: the last thing the admin typed got no
 * answer (the model errored, the connection dropped, Stop was pressed before
 * any text arrived). Pure, so it tests without the panel.
 */

import type { ChatTurn } from "./chatSessionRules";

/**
 * The index of the latest user message that has no assistant text reply after
 * it, or -1 when there is none to retry (no user message yet, or it was
 * answered). A skill run's result is a user-role turn but not something the
 * admin typed, so it is never the message to retry; and it is not a reply
 * either, so a run that landed after an unanswered message leaves that message
 * retryable. An assistant turn with no text (a reply that never started) is not
 * a reply.
 */
export function retryIndex(turns: readonly Pick<ChatTurn, "role" | "content" | "via">[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "assistant") {
      if (t.content.trim()) return -1;
      continue;
    }
    if (t.via === "skill-run") continue;
    return i;
  }
  return -1;
}
