import { prisma } from "@/lib/db";
import { scheduleChatExport } from "@/lib/chatExport";
import { syncSessionAttachments } from "@/lib/chatAttachments";
import { logAudit } from "@/lib/auditLog";
import {
  checkTranscriptSave,
  normalizeSessionBackend,
  normalizeTitle,
  normalizeTurns,
  parseStoredTurns,
  titleFromTurns,
  withProposalRun,
  withRunTurn,
  type ChatSessionFull,
  type ChatSessionSummary,
  type SaveRefusal,
} from "@/lib/chatSessionRules";
import { runTurnContent, type SkillRun } from "@/lib/skillRunnerRules";

/**
 * Saved assistant chats, per admin account. Every read and write is scoped to
 * the caller's user id: a chat id from another account is "not found", never
 * someone else's transcript.
 *
 * Every change is also copied into the Obsidian vault (chatExport.ts), so
 * other assistants and devices can read the conversation.
 */

/** Chats shown in the list; older ones stay stored, just not listed. */
const LIST_LIMIT = 200;

type Row = {
  id: string;
  title: string;
  backend: string;
  turnCount: number;
  version: number;
  updatedAt: Date;
  claudeSessionId: string | null;
};

function summary(row: Row): ChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    backend: normalizeSessionBackend(row.backend),
    turnCount: row.turnCount,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    claudeSessionId: row.claudeSessionId,
  };
}

export async function listChatSessions(userId: string): Promise<ChatSessionSummary[]> {
  const rows = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, title: true, backend: true, turnCount: true, version: true, updatedAt: true, claudeSessionId: true },
  });
  return rows.map(summary);
}

export async function getChatSession(userId: string, id: string): Promise<ChatSessionFull | null> {
  const row = await prisma.chatSession.findFirst({ where: { id, userId } });
  if (!row) return null;
  return { ...summary(row), turns: parseStoredTurns(row.turns) };
}

/**
 * `baseTurnCount`: how many turns the panel last received from the server
 * (see mergeConcurrentTurns). Sent with every transcript save, so turns a
 * linked Claude Code session appended meanwhile are kept, not overwritten.
 */
export type ChatSessionPatch = {
  title?: unknown;
  backend?: unknown;
  turns?: unknown;
  baseTurnCount?: unknown;
  /** The chat's `version` when the panel last received it; a save against an older one is refused. */
  baseVersion?: unknown;
  /** The panel's explicit "I edited or deleted history" flag; without it a save may only append. */
  replace?: unknown;
};

/** The transcript changed elsewhere in a way this save cannot be merged with. */
export class ChatConflictError extends Error {
  constructor(readonly reason: SaveRefusal | "changed-elsewhere" = "changed-elsewhere") {
    super("This chat changed elsewhere since it was loaded.");
  }
}

export async function createChatSession(userId: string, patch: ChatSessionPatch): Promise<ChatSessionFull> {
  const turns = normalizeTurns(patch.turns);
  const typed = normalizeTitle(patch.title);
  const row = await prisma.chatSession.create({
    data: {
      userId,
      title: typed ?? titleFromTurns(turns),
      titleEdited: typed !== null,
      backend: normalizeSessionBackend(patch.backend) ?? "",
      turns: JSON.stringify(turns),
      turnCount: turns.length,
    },
  });
  await syncSessionAttachments(userId, row.id, turns);
  scheduleChatExport(row.id);
  return { ...summary(row), turns };
}

/**
 * Applies whichever of title / backend / turns the patch carries. An empty
 * title hands the chat back to its automatic one. Null when the chat isn't
 * this account's.
 */
export async function updateChatSession(
  userId: string,
  id: string,
  patch: ChatSessionPatch
): Promise<ChatSessionFull | null> {
  const existing = await prisma.chatSession.findFirst({ where: { id, userId } });
  if (!existing) return null;

  let turns = parseStoredTurns(existing.turns);
  if (patch.turns !== undefined) {
    const seen = typeof patch.baseVersion === "number" && Number.isInteger(patch.baseVersion) ? patch.baseVersion : null;
    if (seen !== null && seen !== existing.version) return refuse(userId, id, "stale-version", turns.length, 0);
    // Replacing history needs the turn count the panel saw, and it must still be the stored one.
    if (patch.replace === true && patch.baseTurnCount !== turns.length) {
      return refuse(userId, id, "replace-without-base", turns.length, 0);
    }
  }
  // A rename is its own request: a transcript save never changes the title.
  if (patch.turns !== undefined && patch.title !== undefined) {
    await refuse(userId, id, "title-with-turns", turns.length, 0);
  }
  if (patch.turns !== undefined) {
    const base = typeof patch.baseTurnCount === "number" && Number.isInteger(patch.baseTurnCount) ? patch.baseTurnCount : null;
    const incoming = normalizeTurns(patch.turns);
    const checked = checkTranscriptSave(turns, incoming, base, patch.replace === true);
    if (!checked.ok) return refuse(userId, id, checked.reason, turns.length, incoming.length);
    turns = checked.turns;
  }
  let title = existing.title;
  let titleEdited = existing.titleEdited;
  if (patch.title !== undefined) {
    const typed = normalizeTitle(patch.title);
    titleEdited = typed !== null;
    title = typed ?? titleFromTurns(turns);
  } else if (!titleEdited) {
    title = titleFromTurns(turns);
  }

  // Compare-and-swap on the version read above: a write that landed since is a 409, not an overwrite.
  let row;
  try {
    row = await prisma.chatSession.update({
      where: { id, version: existing.version },
      data: {
        title,
        titleEdited,
        version: { increment: 1 },
        ...(patch.backend !== undefined ? { backend: normalizeSessionBackend(patch.backend) ?? "" } : {}),
        ...(patch.turns !== undefined ? { turns: JSON.stringify(turns), turnCount: turns.length } : {}),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return refuse(userId, id, "stale-version", turns.length, 0);
    throw err;
  }
  if (patch.turns !== undefined) await syncSessionAttachments(userId, row.id, turns);
  scheduleChatExport(row.id);
  return { ...summary(row), turns };
}

/** Logs a refused save (the console and the audit log) and throws the 409. */
async function refuse(userId: string, id: string, reason: SaveRefusal, stored: number, incoming: number): Promise<never> {
  const detail = `refused save to chat ${id}: ${reason} (stored ${stored} turns, incoming ${incoming})`;
  console.warn(`[chat-sessions] ${detail}`);
  await logAudit(userId, "assistant.chat.save.refused", id, detail);
  throw new ChatConflictError(reason);
}

/**
 * A skill run's turn written into one chat, by id: the run's turn there is
 * rewritten with its current state, or added when the chat has none yet. The
 * content comes from the runner's own record of the run, never from the
 * browser, and nothing else in the transcript is touched -- so the report
 * lands in the chat the run was started from, whichever chat is open.
 */
export async function applyRunTurn(
  userId: string,
  id: string,
  run: SkillRun,
  proposal?: { turn: number; block: number }
): Promise<ChatSessionFull | null> {
  const existing = await prisma.chatSession.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const stored = parseStoredTurns(existing.turns);
  let turns = withRunTurn(stored, run.id, runTurnContent(run));
  // The proposal the Run tap came from is linked to the run in the same write,
  // so the card never has a moment with a run turn but no link.
  if (proposal) turns = withProposalRun(turns, proposal.turn, proposal.block, run.skill, run.id);
  if (turns.length === stored.length && turns.every((t, i) => t === stored[i])) return { ...summary(existing), turns };
  const row = await prisma.chatSession.update({
    where: { id },
    data: {
      turns: JSON.stringify(turns),
      turnCount: turns.length,
      version: { increment: 1 },
      ...(existing.titleEdited ? {} : { title: titleFromTurns(turns) }),
    },
  });
  scheduleChatExport(row.id);
  return { ...summary(row), turns };
}

export async function deleteChatSession(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.chatSession.deleteMany({ where: { id, userId } });
  if (count > 0) scheduleChatExport(id);
  return count > 0;
}
