import { prisma } from "@/lib/db";
import { scheduleChatExport } from "@/lib/chatExport";
import {
  normalizeSessionBackend,
  normalizeTitle,
  normalizeTurns,
  parseStoredTurns,
  titleFromTurns,
  type ChatSessionFull,
  type ChatSessionSummary,
} from "@/lib/chatSessionRules";

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
  updatedAt: Date;
};

function summary(row: Row): ChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    backend: normalizeSessionBackend(row.backend),
    turnCount: row.turnCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listChatSessions(userId: string): Promise<ChatSessionSummary[]> {
  const rows = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, title: true, backend: true, turnCount: true, updatedAt: true },
  });
  return rows.map(summary);
}

export async function getChatSession(userId: string, id: string): Promise<ChatSessionFull | null> {
  const row = await prisma.chatSession.findFirst({ where: { id, userId } });
  if (!row) return null;
  return { ...summary(row), turns: parseStoredTurns(row.turns) };
}

export type ChatSessionPatch = { title?: unknown; backend?: unknown; turns?: unknown };

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

  const turns = patch.turns !== undefined ? normalizeTurns(patch.turns) : parseStoredTurns(existing.turns);
  let title = existing.title;
  let titleEdited = existing.titleEdited;
  if (patch.title !== undefined) {
    const typed = normalizeTitle(patch.title);
    titleEdited = typed !== null;
    title = typed ?? titleFromTurns(turns);
  } else if (!titleEdited) {
    title = titleFromTurns(turns);
  }

  const row = await prisma.chatSession.update({
    where: { id },
    data: {
      title,
      titleEdited,
      ...(patch.backend !== undefined ? { backend: normalizeSessionBackend(patch.backend) ?? "" } : {}),
      ...(patch.turns !== undefined ? { turns: JSON.stringify(turns), turnCount: turns.length } : {}),
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
