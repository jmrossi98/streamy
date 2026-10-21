/**
 * Saved admin chats, copied into the Obsidian vault as Markdown so every
 * other assistant and device can read them: Claude Code on any machine (its
 * vault mirror), Obsidian on the phone and laptop, and this panel itself on
 * any model. See sharedVaultRules.ts for the layout.
 *
 * The database stays the source of truth. The vault copy is rewritten on
 * every save and removed when the chat is deleted; a failure here is logged
 * and never fails the save -- the catch-up sweep repairs it later.
 */
import { prisma } from "@/lib/db";
import { parseStoredTurns } from "@/lib/chatSessionRules";
import { chatNotePath, chatNoteSuffix, renderChatNote, STREAMY_CHATS_DIR } from "@/lib/sharedVaultRules";
import { deleteVaultNote, isVaultConfigured, listVaultDir, writeVaultNote } from "@/lib/vault";

/** Saves land a few at a time while an answer streams in; write once they settle. */
const DEBOUNCE_MS = 3_000;
/** How often the catch-up sweep may run, per server process. */
const SWEEP_EVERY_MS = 10 * 60_000;
/** Setting row: {chatId: updatedAt ISO} of what the vault already has. */
const EXPORTED_KEY = "chat_vault_exported";

const pending = new Map<string, ReturnType<typeof setTimeout>>();
let lastSweep = 0;

async function readExported(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: EXPORTED_KEY }, select: { value: true } });
  try {
    const parsed = row ? JSON.parse(row.value) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function markExported(id: string, updatedAt: string | null): Promise<void> {
  const map = await readExported();
  if (updatedAt) map[id] = updatedAt;
  else delete map[id];
  const value = JSON.stringify(map);
  await prisma.setting.upsert({ where: { key: EXPORTED_KEY }, create: { key: EXPORTED_KEY, value }, update: { value } });
}

/** Removes every vault copy of one chat except `keep` (an old title's file, or all of them). */
async function removeCopies(id: string, keep: string | null): Promise<void> {
  const suffix = chatNoteSuffix(id);
  for (const entry of await listVaultDir(STREAMY_CHATS_DIR)) {
    if (!entry.isDir && entry.path.toLowerCase().endsWith(suffix) && entry.path !== keep) {
      await deleteVaultNote(entry.path);
    }
  }
}

/** Writes (or removes) the vault copy of one chat, matching the database now. */
export async function exportChatToVault(id: string): Promise<void> {
  if (!isVaultConfigured()) return;
  const row = await prisma.chatSession.findUnique({ where: { id } });
  const turns = row ? parseStoredTurns(row.turns) : [];
  // Deleted, or still an empty "New chat": nothing worth a note.
  if (!row || turns.length === 0) {
    await removeCopies(id, null);
    await markExported(id, null);
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { name: true } });
  const path = chatNotePath(row);
  await writeVaultNote(
    path,
    renderChatNote({
      id: row.id,
      title: row.title,
      backend: row.backend,
      author: user?.name || "Admin",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      turns,
    })
  );
  await removeCopies(id, path);
  await markExported(id, row.updatedAt.toISOString());
}

/** Fire-and-forget export after a save, coalescing a burst of saves into one write. */
export function scheduleChatExport(id: string): void {
  if (!isVaultConfigured()) return;
  const existing = pending.get(id);
  if (existing) clearTimeout(existing);
  pending.set(
    id,
    setTimeout(() => {
      pending.delete(id);
      exportChatToVault(id).catch((err) => console.error(`[chat-export] ${id}:`, err instanceof Error ? err.message : err));
    }, DEBOUNCE_MS)
  );
}

/**
 * Brings the vault in line with every saved chat: writes the ones changed
 * since their last export (including chats from before this existed) and
 * removes the ones since deleted. Throttled; called when the panel lists chats.
 */
export async function sweepChatExports(): Promise<void> {
  if (!isVaultConfigured() || Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  const exported = await readExported();
  const rows = await prisma.chatSession.findMany({ select: { id: true, updatedAt: true, turnCount: true } });
  const live = new Set(rows.map((r) => r.id));
  const stale = rows.filter((r) => r.turnCount > 0 && exported[r.id] !== r.updatedAt.toISOString()).map((r) => r.id);
  const gone = Object.keys(exported).filter((id) => !live.has(id));
  for (const id of [...stale, ...gone]) {
    try {
      await exportChatToVault(id);
    } catch (err) {
      console.error(`[chat-export] sweep ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (stale.length + gone.length > 0) console.log(`[chat-export] sweep: ${stale.length} written, ${gone.length} removed`);
}
