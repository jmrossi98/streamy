/**
 * Claude Code sessions, offered in the admin chat so one can be picked up
 * here. They come from the vault (the sync script pushes them after every
 * Claude Code response), and opening one makes an ordinary saved chat linked
 * to that session: from then on the chat bridge carries turns both ways
 * (chatBridge.ts). Chats imported from the Claude app sit beside them and
 * open the same way, except that nothing flows back (their stored id carries
 * an "app-" prefix, which the bridge leaves alone).
 */
import { prisma } from "@/lib/db";
import { scheduleChatExport } from "@/lib/chatExport";
import { getChatSession } from "@/lib/chatSessions";
import { normalizeTurns, type ChatSessionFull } from "@/lib/chatSessionRules";
import {
  CLAUDE_APP_CHATS_DIR,
  CLAUDE_CODE_CHATS_DIR,
  listClaudeCodeSessions,
  parseClaudeCodeNote,
  storedSessionId,
  type ClaudeCodeSessionRef,
} from "@/lib/claudeCodeNoteRules";
import { isVaultConfigured, listVaultFiles, readVaultNote } from "@/lib/vault";
import { isReadableNote } from "@/lib/vaultRules";

const LIST_LIMIT = 60;

export type ClaudeCodeChatListing = {
  key: string;
  machine: string;
  title: string;
  modified: string | null;
  /** The saved chat already continuing this session, if there is one. */
  chatId: string | null;
};

async function sessionRefs(): Promise<ClaudeCodeSessionRef[]> {
  if (!isVaultConfigured()) return [];
  const [code, app] = await Promise.all([
    listVaultFiles(CLAUDE_CODE_CHATS_DIR, isReadableNote, 2000),
    listVaultFiles(CLAUDE_APP_CHATS_DIR, isReadableNote, 2000),
  ]);
  return listClaudeCodeSessions([...code, ...app]);
}

export async function listClaudeCodeChats(userId: string): Promise<ClaudeCodeChatListing[]> {
  const refs = (await sessionRefs()).slice(0, LIST_LIMIT);
  const linked = await prisma.chatSession.findMany({
    where: { userId, claudeSessionId: { not: null } },
    select: { id: true, claudeSessionId: true },
  });
  return refs.map((r) => ({
    key: r.key,
    machine: r.machine,
    title: r.title,
    modified: r.modified ? new Date(r.modified).toISOString() : null,
    chatId: linked.find((l) => l.claudeSessionId?.startsWith(storedSessionId(r.machine, r.sid8)))?.id ?? null,
  }));
}

/**
 * The saved chat continuing a Claude Code session: the existing one, or a new
 * one seeded with the session's conversation from the vault. Null when the
 * session isn't in the vault.
 */
export async function openClaudeCodeChat(userId: string, key: string): Promise<ChatSessionFull | null> {
  const ref = (await sessionRefs()).find((r) => r.key === key);
  if (!ref) return null;

  const notes = await Promise.all(ref.parts.map((p) => readVaultNote(p).then(parseClaudeCodeNote)));
  const sessionId = notes[0]?.sessionId;
  if (!sessionId) return null;

  const stored = storedSessionId(ref.machine, sessionId);
  const existing = await prisma.chatSession.findFirst({ where: { userId, claudeSessionId: stored }, select: { id: true } });
  if (existing) return getChatSession(userId, existing.id);

  const turns = normalizeTurns(notes.flatMap((n) => n.turns));
  const title = (notes[0].title || ref.title).slice(0, 120);
  const row = await prisma.chatSession.create({
    data: {
      userId,
      title,
      titleEdited: true,
      backend: "claude",
      turns: JSON.stringify(turns),
      turnCount: turns.length,
      claudeSessionId: stored,
      // Claude Code was there for all of these; only what is added here is news to it.
      claudeSeenTurns: turns.length,
    },
  });
  scheduleChatExport(row.id);
  return getChatSession(userId, row.id);
}
