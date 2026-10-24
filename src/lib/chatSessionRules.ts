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

/**
 * One turn. `via` marks a turn that happened in a linked Claude Code session
 * rather than in this panel, or ("skill-run", 2026-10-24) a Claude Code skill
 * run on mediabox -- a user-role turn, so the model reads the result as input
 * and can carry on from it (skillRunnerRules.ts). Absent means typed here.
 */
export type ChatTurnVia = "claude-code" | "skill-run";
export type ChatTurn = { role: "user" | "assistant"; content: string; via?: ChatTurnVia };

export type ChatSessionSummary = {
  id: string;
  title: string;
  backend: ChatBackendId | null;
  turnCount: number;
  updatedAt: string;
  /** The Claude Code session this chat is shared with, or null. */
  claudeSessionId: string | null;
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
    const { role, content, via } = t as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const turn: ChatTurn = { role, content: content.slice(0, MAX_TURN_CHARS) };
    if (via === "claude-code" || via === "skill-run") turn.via = via;
    out.push(turn);
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

function sameTurn(a: ChatTurn, b: ChatTurn): boolean {
  return a.role === b.role && a.content === b.content;
}

/**
 * A whole-transcript save from the panel, reconciled with turns added
 * elsewhere (a linked Claude Code session) since the panel last synced.
 *
 * `base` is how many turns the panel last received from the server, so the
 * first `base` turns it sends are its copy of the stored ones. When nothing
 * was added since, the save simply replaces the transcript (edits, deletes).
 * When turns were added and the panel's copy of the old ones still matches,
 * the added turns are kept and the panel's new turns go after them. When the
 * old ones no longer match -- the panel edited history while something else
 * appended -- there is no safe merge: null, and the caller refuses the save.
 */
export function mergeConcurrentTurns(stored: ChatTurn[], incoming: ChatTurn[], base: number | null): ChatTurn[] | null {
  if (base === null || base === stored.length) return incoming;
  if (base > stored.length || base > incoming.length) return null;
  for (let i = 0; i < base; i++) if (!sameTurn(stored[i], incoming[i])) return null;
  return [...stored, ...incoming.slice(base)].slice(-MAX_SESSION_TURNS);
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
