/**
 * Composer input history: ArrowUp in the chat box recalls the chat's earlier
 * user messages, newest first; ArrowDown walks back toward the draft that was
 * in the box before the walk began. Pure, so the component only wires keys.
 */

export type HistoryPos = {
  /** Steps back from the newest message (0 = newest); -1 when not cycling. */
  index: number;
  /** What was in the box before the first ArrowUp. */
  draft: string;
};

export const HISTORY_IDLE: HistoryPos = { index: -1, draft: "" };

export type HistoryStep = { pos: HistoryPos; text: string };

/** The user messages of a chat, oldest first, skipping blanks. */
export function userMessages(turns: ReadonlyArray<{ role: string; content: string }>): string[] {
  return turns.flatMap((t) => (t.role === "user" && t.content.trim() ? [t.content] : []));
}

/**
 * Whether the arrow key should be taken for history rather than moving the
 * caret: ArrowUp on an empty box or with the caret on the first line,
 * ArrowDown with the caret on the last line. A selection is never taken.
 */
export function shouldIntercept(
  direction: "up" | "down",
  value: string,
  selectionStart: number,
  selectionEnd: number
): boolean {
  if (selectionStart !== selectionEnd) return false;
  if (direction === "up") return value === "" || !value.slice(0, selectionStart).includes("\n");
  return !value.slice(selectionEnd).includes("\n");
}

/**
 * One ArrowUp/ArrowDown. `messages` is oldest first, `current` the box's text.
 * Returns the new position and the text to show, or null when nothing changes
 * (no history, already at the oldest, or ArrowDown while not cycling).
 */
export function stepHistory(
  pos: HistoryPos,
  direction: "up" | "down",
  messages: readonly string[],
  current: string
): HistoryStep | null {
  if (direction === "up") {
    if (messages.length === 0) return null;
    const next = pos.index + 1;
    if (next >= messages.length) return null;
    const draft = pos.index < 0 ? current : pos.draft;
    return { pos: { index: next, draft }, text: messages[messages.length - 1 - next] };
  }
  if (pos.index < 0) return null;
  if (pos.index === 0) return { pos: HISTORY_IDLE, text: pos.draft };
  const next = pos.index - 1;
  return { pos: { index: next, draft: pos.draft }, text: messages[messages.length - 1 - next] };
}
