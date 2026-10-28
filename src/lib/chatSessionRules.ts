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
import type { BadgeTone } from "@/components/ui";
import { CHATGPT_MACHINE, CLAUDE_APP_MACHINE } from "./claudeCodeNoteRules";
import { normalizeAttachmentRefs, type AttachmentRef } from "./chatAttachmentRules";
import { findRunTurn, isFinished, normalizeProposalRuns, parseRunTurn, parseSkillProposal, type ProposalRuns } from "./skillRunnerRules";

/**
 * One turn. `via` marks a turn that happened in a linked Claude Code session
 * rather than in this panel, or ("skill-run", 2026-10-24) a Claude Code skill
 * run on mediabox -- a user-role turn, so the model reads the result as input
 * and can carry on from it (skillRunnerRules.ts) -- or ("claude-app") a turn
 * imported from a claude.ai chat. Absent means typed here.
 */
export type ChatTurnVia = "claude-code" | "claude-app" | "chatgpt" | "skill-run";
export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  via?: ChatTurnVia;
  /** Files attached to a user turn (ChatAttachment rows hold the bytes). */
  attachments?: AttachmentRef[];
  /**
   * On an assistant turn: proposal block index -> the skill run its Run tap
   * started (skillRunnerRules linkedRunId). Set server-side with the run's turn.
   */
  proposalRuns?: ProposalRuns;
};

export type ChatSessionSummary = {
  id: string;
  title: string;
  backend: ChatBackendId | null;
  turnCount: number;
  updatedAt: string;
  /** Write counter for the save guard (see ChatSessionPatch.baseVersion). */
  version?: number;
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
    const { role, content, via, attachments, proposalRuns } = t as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const turn: ChatTurn = { role, content: content.slice(0, MAX_TURN_CHARS) };
    const refs = role === "user" ? normalizeAttachmentRefs(attachments) : [];
    if (refs.length > 0) turn.attachments = refs;
    const links = role === "assistant" ? normalizeProposalRuns(proposalRuns) : null;
    if (links) turn.proposalRuns = links;
    if (via === "claude-code" || via === "claude-app" || via === "chatgpt" || via === "skill-run") turn.via = via;
    out.push(turn);
  }
  return out.slice(-MAX_SESSION_TURNS);
}

/** The run id a skill-run turn holds, or null for any other turn. */
export function runIdOf(turn: Pick<ChatTurn, "content" | "via">): string | null {
  return turn.via === "skill-run" ? (parseRunTurn(turn.content)?.id ?? null) : null;
}

/**
 * At most one turn per skill run: the first turn's place, with the most
 * finished text seen (a finished report beats a "running" copy; between equals
 * the later wins). Returns the same array when there is nothing to remove.
 */
export function dedupeRunTurns<T extends Pick<ChatTurn, "content" | "via">>(turns: T[]): T[] {
  const best = new Map<string, { at: number; turn: T; done: boolean }>();
  let dupes = 0;
  turns.forEach((turn, at) => {
    const id = runIdOf(turn);
    if (id === null) return;
    const done = isFinished(parseRunTurn(turn.content)?.status ?? "failed");
    const seen = best.get(id);
    if (!seen) return void best.set(id, { at, turn, done });
    dupes++;
    if (done || !seen.done) best.set(id, { at: seen.at, turn, done });
  });
  if (dupes === 0) return turns;
  return turns.flatMap((turn, at) => {
    const id = runIdOf(turn);
    if (id === null) return [turn];
    const b = best.get(id)!;
    return b.at === at ? [b.turn] : [];
  });
}

/** The stored JSON column, read back. A corrupt row reads as empty, never throws. */
export function parseStoredTurns(json: string | null | undefined): ChatTurn[] {
  if (!json) return [];
  try {
    return dedupeRunTurns(normalizeTurns(JSON.parse(json)));
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

/**
 * The same turn: role and text, except a run's turn, which is rewritten in
 * place as the run goes -- two copies of one run's turn are the same turn
 * whatever state each has reached.
 */
export function sameTurn(a: ChatTurn, b: ChatTurn): boolean {
  if (a.role !== b.role) return false;
  if (a.content === b.content) return true;
  const id = runIdOf(a);
  return id !== null && id === runIdOf(b);
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

/** Why a save was refused (logged server-side, never shown as a transcript). */
export type SaveRefusal = "not-append" | "title-with-turns" | "stale-base" | "stale-version" | "replace-without-base";

function startsWith(incoming: ChatTurn[], prefix: ChatTurn[]): boolean {
  if (prefix.length > incoming.length) return false;
  for (let i = 0; i < prefix.length; i++) if (!sameTurn(prefix[i], incoming[i])) return false;
  return true;
}

/**
 * The guard on a transcript save. A plain save may only add to what is stored:
 * its first turns must be the stored ones, in order, so a transcript that
 * belongs to another chat can never replace this one. (Turns carry no ids; role
 * and text are what identify one.) A chat already at MAX_SESSION_TURNS drops its
 * oldest turn per new one, so a shifted prefix still counts.
 *
 * `replace` is the panel's explicit "I edited or deleted history" flag, set only
 * by those actions; it keeps the older rules (mergeConcurrentTurns).
 */
export function checkTranscriptSave(
  stored: ChatTurn[],
  incoming: ChatTurn[],
  base: number | null,
  replace: boolean
): { ok: true; turns: ChatTurn[] } | { ok: false; reason: SaveRefusal } {
  const checked = checkSave(stored, incoming, base, replace);
  return checked.ok ? { ok: true, turns: dedupeRunTurns(checked.turns) } : checked;
}

/**
 * The panel's copy of a run's turn may be older than the stored one (the server
 * rewrites it as the run goes), so a plain save keeps the stored text for any
 * run turn the chat already has.
 */
function adoptStoredRunTurns(stored: ChatTurn[], incoming: ChatTurn[]): ChatTurn[] {
  const byId = new Map<string, ChatTurn>();
  for (const t of stored) {
    const id = runIdOf(t);
    if (id !== null && !byId.has(id)) byId.set(id, t);
  }
  if (byId.size === 0) return incoming;
  return incoming.map((t) => {
    const id = runIdOf(t);
    return (id !== null && byId.get(id)) || t;
  });
}

function checkSave(
  stored: ChatTurn[],
  incoming: ChatTurn[],
  base: number | null,
  replace: boolean
): { ok: true; turns: ChatTurn[] } | { ok: false; reason: SaveRefusal } {
  if (replace) {
    const merged = mergeConcurrentTurns(stored, incoming, base);
    return merged ? { ok: true, turns: merged } : { ok: false, reason: "stale-base" };
  }
  incoming = adoptStoredRunTurns(stored, incoming);
  if (base !== null && base > stored.length) return { ok: false, reason: "stale-base" };
  const known = base === null ? stored.length : base;
  if (known === stored.length) {
    // Stored turns may have shifted off the front when the chat was full.
    const shifts = stored.length >= MAX_SESSION_TURNS ? stored.length : 0;
    for (let s = 0; s <= shifts; s++) {
      if (startsWith(incoming, stored.slice(s))) return { ok: true, turns: carryLinks(stored.slice(s), incoming) };
    }
    return { ok: false, reason: "not-append" };
  }
  // Turns were added elsewhere since the panel synced: its copy of the older
  // ones must still match, and its new turns go after the added ones.
  if (!startsWith(incoming, stored.slice(0, known))) return { ok: false, reason: "not-append" };
  return { ok: true, turns: [...stored, ...incoming.slice(known)].slice(-MAX_SESSION_TURNS) };
}

/**
 * An append-only save whose first turns are the stored ones keeps the stored
 * turns' proposal links: the server sets them, so a panel copy that predates
 * the link must not erase it.
 */
function carryLinks(prefix: ChatTurn[], incoming: ChatTurn[]): ChatTurn[] {
  return incoming.map((t, i) => (i < prefix.length && prefix[i].proposalRuns && !t.proposalRuns ? { ...t, proposalRuns: prefix[i].proposalRuns } : t));
}

/**
 * A skill run's turn put into a chat's transcript by the server: the existing
 * turn for that run is rewritten in place, otherwise the turn is appended.
 * Nothing else in the transcript moves.
 */
export function withRunTurn(turns: ChatTurn[], runId: string, content: string): ChatTurn[] {
  const index = findRunTurn(turns, runId);
  if (index < 0) {
    const turn: ChatTurn = { role: "user", via: "skill-run", content };
    return [...turns, turn].slice(-MAX_SESSION_TURNS);
  }
  return editTurn(turns, index, content);
}

/**
 * Links block `block` of the assistant turn at `index` to run `runId`. Only a
 * turn that really holds a proposal for `skill` takes it, and a block that is
 * already linked keeps its first run (a second tap must not re-point the card).
 * Anything else returns the transcript unchanged.
 */
export function withProposalRun(turns: ChatTurn[], index: number, block: number, skill: string, runId: string): ChatTurn[] {
  const turn = turns[index];
  if (!turn || turn.role !== "assistant" || turn.via) return turns;
  if (!Number.isInteger(block) || block < 0 || block > 999) return turns;
  if (parseSkillProposal(turn.content)?.skill !== skill) return turns;
  if (turn.proposalRuns?.[String(block)]) return turns;
  return turns.map((t, i) => (i === index ? { ...t, proposalRuns: { ...t.proposalRuns, [String(block)]: runId } } : t));
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
  const kept = turn.attachments?.length ? { attachments: turn.attachments } : {};
  return [...turns.slice(0, index), { role: "user", content: content.trim(), ...kept }];
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

/** Where a row of the chat list comes from; its badge reads "Streamy", "Claude Code", "Claude" or "ChatGPT". */
export type ChatListSource = "streamy" | "claude-code" | "claude-app" | "chatgpt";
type VaultListSource = Exclude<ChatListSource, "streamy">;

/** The label on a chat-list row's source badge. */
export const CHAT_SOURCE_LABELS: Record<ChatListSource, string> = {
  streamy: "Streamy",
  "claude-code": "Claude Code",
  "claude-app": "Claude",
  chatgpt: "ChatGPT",
};

/** The badge tone per source: Streamy red, one Claude orange for both Claude sources, ChatGPT white. */
export const CHAT_SOURCE_TONES: Record<ChatListSource, BadgeTone> = {
  streamy: "streamy",
  "claude-code": "claude",
  "claude-app": "claude",
  chatgpt: "chatgpt",
};

/** Which source a vault session is, by the machine name it lists under. */
export function vaultChatSource(machine: string): VaultListSource {
  if (machine === CLAUDE_APP_MACHINE) return "claude-app";
  if (machine === CHATGPT_MACHINE) return "chatgpt";
  return "claude-code";
}

/** A vault session as the list gets it (ChatSessionList's ClaudeCodeSessionItem). */
type VaultSessionLike = { machine: string; modified: string | null; chatId?: string | null };

/**
 * A saved chat row. `badge` is where the conversation began: "streamy" for a
 * plain chat, or the Claude Code / Claude app source it continues, in which
 * case `vault` is that source (folded into this one row). `at` is the later of
 * the two activity times.
 */
export type ChatListEntry<V extends VaultSessionLike> =
  | { source: "streamy"; key: string; at: number; session: ChatSessionSummary; badge: ChatListSource; vault: V | null }
  | { source: VaultListSource; key: string; at: number; vault: V };

/**
 * Saved chats, Claude Code sessions and Claude app chats as one list, most
 * recent activity first. A vault session already continued by a saved chat
 * (its `chatId` names that chat) is not a row of its own: the saved chat's row
 * carries the source badge and the later of the two times, and opening, renaming
 * or deleting it acts on the saved chat. A row with no usable time sorts last;
 * ties keep their incoming order (Array.sort is stable), saved chats first.
 */
export function mergeChatList<V extends VaultSessionLike & { key: string }>(
  sessions: ChatSessionSummary[],
  vault: V[]
): ChatListEntry<V>[] {
  const time = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  const sourceOf = (v: V): VaultListSource => vaultChatSource(v.machine);
  const ids = new Set(sessions.map((s) => s.id));
  const linked = new Map<string, V>();
  for (const v of vault) if (v.chatId && ids.has(v.chatId) && !linked.has(v.chatId)) linked.set(v.chatId, v);
  const folded = new Set(linked.values());
  const rows: ChatListEntry<V>[] = [
    ...sessions.map((session): ChatListEntry<V> => {
      const v = linked.get(session.id) ?? null;
      return {
        source: "streamy",
        key: `s:${session.id}`,
        at: Math.max(time(session.updatedAt), v ? time(v.modified) : 0),
        session,
        badge: v ? sourceOf(v) : "streamy",
        vault: v,
      };
    }),
    ...vault
      .filter((v) => !folded.has(v))
      .map((v): ChatListEntry<V> => ({ source: sourceOf(v), key: `v:${v.key}`, at: time(v.modified), vault: v })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}
