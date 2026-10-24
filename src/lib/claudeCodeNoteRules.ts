/**
 * Claude Code sessions as the sync script writes them into the vault
 * (main/ai/chats/claude-code/<machine>/<day>-<slug>-<sid8>[-partN].md), read
 * back so a session can be continued in the admin chat.
 *
 * Chats from the Claude app (claude.ai, the desktop and phone apps) are the
 * same notes one folder over, main/ai/chats/claude-app/, written by
 * mediabox-infra/scripts/claude_export_import.py from a claude.ai data export
 * (2026-10-24). They list and open the same way, under the machine name
 * "claude-app"; the difference is that nothing flows back to claude.ai, so
 * the chat they open is an import and not a live link.
 *
 * Pure, so it tests without the server stack. The format is set by
 * mediabox-infra/scripts/claude_memory_sync.py (render_session).
 */
import type { ChatTurn, ChatTurnVia } from "./chatSessionRules";
import { AI_CHATS_DIR } from "./sharedVaultRules";
import type { VaultEntry } from "./vaultRules";

export const CLAUDE_CODE_CHATS_DIR = `${AI_CHATS_DIR}/claude-code`;
export const CLAUDE_APP_CHATS_DIR = `${AI_CHATS_DIR}/claude-app`;
/** The machine name a Claude app chat lists under. */
export const CLAUDE_APP_MACHINE = "claude-app";
/** Prefix of the stored session id of a chat opened from a Claude app import. */
const CLAUDE_APP_ID_PREFIX = "app-";

/** The id to store for a session continued here; the bridge ignores app imports. */
export function storedSessionId(machine: string, sessionId: string): string {
  return machine === CLAUDE_APP_MACHINE ? `${CLAUDE_APP_ID_PREFIX}${sessionId}` : sessionId;
}

export function isClaudeAppImport(storedId: string | null | undefined): boolean {
  return !!storedId && storedId.startsWith(CLAUDE_APP_ID_PREFIX);
}

const NOTE_NAME = /^(\d{4}-\d{2}-\d{2}|undated)-(.+)-([0-9a-f]{8})(?:-part(\d+))?\.md$/;

export type ClaudeCodeSessionRef = {
  /** "<machine>/<file stem without -partN>", the handle the panel opens it by. */
  key: string;
  machine: string;
  day: string;
  /** The title, recovered from the file name's slug. */
  title: string;
  /** First 8 characters of Claude Code's session id. */
  sid8: string;
  /** Vault paths of every part, in order. */
  parts: string[];
  modified: number;
};

function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Claude Code session";
}

/** Every session in the vault listing, newest activity first, parts grouped. */
export function listClaudeCodeSessions(entries: VaultEntry[]): ClaudeCodeSessionRef[] {
  const byKey = new Map<string, ClaudeCodeSessionRef & { partNos: number[] }>();
  for (const e of entries) {
    if (e.isDir) continue;
    let machine: string;
    let file: string;
    if (e.path.startsWith(`${CLAUDE_CODE_CHATS_DIR}/`)) {
      const rest = e.path.slice(CLAUDE_CODE_CHATS_DIR.length + 1).split("/");
      if (rest.length !== 2) continue;
      [machine, file] = rest;
    } else if (e.path.startsWith(`${CLAUDE_APP_CHATS_DIR}/`)) {
      file = e.path.slice(CLAUDE_APP_CHATS_DIR.length + 1);
      if (file.includes("/")) continue;
      machine = CLAUDE_APP_MACHINE;
    } else continue;
    const m = NOTE_NAME.exec(file);
    if (!m || !/^[a-z0-9-]+$/.test(machine)) continue;
    const [, day, slug, sid8, partNo] = m;
    const key = `${machine}/${day}-${slug}-${sid8}`;
    const modified = e.modified ? Date.parse(e.modified) || 0 : 0;
    const ref = byKey.get(key) ?? { key, machine, day, title: titleFromSlug(slug), sid8, parts: [], partNos: [], modified: 0 };
    ref.parts.push(e.path);
    ref.partNos.push(partNo ? Number(partNo) : 1);
    ref.modified = Math.max(ref.modified, modified);
    byKey.set(key, ref);
  }
  return [...byKey.values()]
    .map(({ partNos, parts, ...ref }) => ({
      ...ref,
      parts: parts.map((p, i) => [partNos[i], p] as const).sort((a, b) => a[0] - b[0]).map(([, p]) => p),
    }))
    .sort((a, b) => b.modified - a.modified);
}

/** A panel-supplied key, checked before it is used to build a vault path. */
export function isClaudeCodeSessionKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-z0-9-]+\/(\d{4}-\d{2}-\d{2}|undated)-[a-z0-9-]+-[0-9a-f]{8}$/.test(key);
}

export type ParsedClaudeCodeNote = { title: string | null; sessionId: string | null; turns: ChatTurn[] };

const HEADING = /^### (User|Claude(?: \([^)]*\))?|Context summary[^·\n]*?) · [^\n]*$/gm;

/**
 * One note's front matter and turns. User turns stay the user's; Claude's
 * replies and the compaction summaries become assistant turns. All are marked
 * as having happened in Claude Code.
 */
export function parseClaudeCodeNote(md: string): ParsedClaudeCodeNote {
  let body = md;
  let title: string | null = null;
  let sessionId: string | null = null;
  let via: ChatTurnVia = "claude-code";
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (fm) {
    body = md.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const [k, ...v] = line.split(":");
      const value = v.join(":").trim();
      if (k === "title") {
        try {
          title = JSON.parse(value) as string;
        } catch {
          title = value || null;
        }
      }
      if (k === "session" && /^[0-9a-f-]{8,64}$/i.test(value)) sessionId = value.toLowerCase();
      if (k === "source" && value === "claude-app") via = "claude-app";
    }
  }
  const turns: ChatTurn[] = [];
  const heads = [...body.matchAll(HEADING)];
  heads.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : body.length;
    const text = body.slice(start, end).trim();
    if (!text) return;
    if (h[1] === "User") turns.push({ role: "user", content: text, via });
    else if (h[1].startsWith("Context summary"))
      turns.push({ role: "assistant", content: `**Summary of the earlier conversation**\n\n${text}`, via });
    else turns.push({ role: "assistant", content: text, via });
  });
  return { title, sessionId, turns };
}
