/**
 * Saved assistant chats: what a stored transcript may hold, and the edits the
 * panel makes to one.
 *
 * Pure, so it tests without the server stack. The transcript is sent by the
 * browser and is data like any other request body: every turn is re-checked
 * here before it is stored, and again when it is read back.
 *
 * Storing a long transcript costs nothing at send time -- the chat route still
 * only forwards the last MAX_HISTORY_MESSAGES turns to the model -- so the
 * caps here are about keeping one row a sane size, not about the bill.
 */

import { CHAT_BACKENDS, type ChatBackendId } from "./chatModels";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatSessionSummary = {
  id: string;
  title: string;
  backend: ChatBackendId | null;
  turnCount: number;
  updatedAt: string;
};

export type ChatSessionFull = ChatSessionSummary & { turns: ChatTurn[] };

/** Turns kept per chat; the oldest go first past this. */
export const MAX_SESSION_TURNS = 400;
/** Characters per stored turn. Long replies fit; a pasted log is cut. */
export const MAX_TURN_CHARS = 60_000;
export const MAX_TITLE_CHARS = 120;
/** How much of the first question becomes the automatic title. */
export const AUTO_TITLE_CHARS = 60;
export const UNTITLED = "New chat";

/** Coerces a submitted (or stored) transcript to valid turns, dropping the rest. */
export function normalizeTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const { role, content } = t as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    out.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
  }
  return out.slice(-MAX_SESSION_TURNS);
}

/** The stored JSON column, read back. A corrupt row reads as empty, never throws. */
export function parseStoredTurns(json: string | null | undefined): ChatTurn[] {
  if (!json) return [];
  try {
    return normalizeTurns(JSON.parse(json));
  } catch {
    return [];
  }
}

/** A title typed by hand: one line, trimmed, capped. Null when there is nothing left. */
export function normalizeTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  return t || null;
}

/** The first question, cut at a word boundary, or "New chat" before there is one. */
export function titleFromTurns(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.role === "user" && t.content.trim());
  if (!first) return UNTITLED;
  const flat = first.content.replace(/\s+/g, " ").trim();
  if (flat.length <= AUTO_TITLE_CHARS) return flat;
  const cut = flat.slice(0, AUTO_TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > AUTO_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A stored slot name, or null for one this build doesn't know. */
export function normalizeSessionBackend(raw: unknown): ChatBackendId | null {
  return CHAT_BACKENDS.some((b) => b.id === raw) ? (raw as ChatBackendId) : null;
}

/** The transcript with one turn's text replaced. Out of range is a no-op. */
export function editTurn(turns: ChatTurn[], index: number, content: string): ChatTurn[] {
  if (index < 0 || index >= turns.length) return turns;
  return turns.map((t, i) => (i === index ? { ...t, content } : t));
}

/** The transcript without one turn. Out of range is a no-op. */
export function deleteTurn(turns: ChatTurn[], index: number): ChatTurn[] {
  if (index < 0 || index >= turns.length) return turns;
  return turns.filter((_, i) => i !== index);
}

/**
 * For "edit and ask again": the transcript up to and including the edited
 * question, with everything after it dropped -- the old answer was to the old
 * question. Null when the turn isn't a question, or the edit left it empty.
 */
export function resendFrom(turns: ChatTurn[], index: number, content: string): ChatTurn[] | null {
  const turn = turns[index];
  if (!turn || turn.role !== "user" || !content.trim()) return null;
  return [...turns.slice(0, index), { role: "user", content: content.trim() }];
}

/** "now", "5m", "3h", "2d", then a short date: how long ago a chat was last used. */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor(Math.max(0, now - t) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
