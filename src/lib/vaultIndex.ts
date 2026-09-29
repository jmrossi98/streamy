/**
 * The Obsidian vault as a searchable index for the admin assistant.
 *
 * Same keyword scoring as the repo documentation (docsRetrieval.ts), built
 * here rather than by docs-index.py because the vault lives on mediabox and
 * that index is built on the desktop, where the repos are. Read over WebDAV,
 * chunked by heading, cached for a few minutes so a conversation does not
 * re-read the vault on every message.
 */
import { cached } from "./ttlCache";
import { tokenize, type Chunk, type DocsIndex } from "./docsRetrieval";
import { isVaultConfigured, listVaultNotes, readVaultNote } from "./vault";

const CACHE_MS = 5 * 60_000;
const MAX_NOTES = 400;
const MAX_CHUNK_CHARS = 1500;

/** Splits a note into heading-led chunks, each at most MAX_CHUNK_CHARS. */
export function chunkNote(path: string, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const noteTitle = path.split("/").pop()!.replace(/\.md$/i, "");
  let title = noteTitle;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    for (let i = 0; i < body.length; i += MAX_CHUNK_CHARS) {
      const piece = body.slice(i, i + MAX_CHUNK_CHARS);
      if (piece.trim()) chunks.push({ id: `vault:${path}:${chunks.length}`, repo: "vault", path, title, text: piece });
    }
  };
  for (const line of text.split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      title = `${noteTitle} > ${h[1].trim()}`;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

export function indexNotes(notes: { path: string; text: string }[]): DocsIndex {
  const chunks = notes.flatMap((n) => chunkNote(n.path, n.text));
  const df: Record<string, number> = {};
  for (const c of chunks) for (const t of new Set(tokenize(c.text))) df[t] = (df[t] ?? 0) + 1;
  return { generatedAt: new Date().toISOString(), chunks, df };
}

export async function getVaultIndex(): Promise<DocsIndex | null> {
  if (!isVaultConfigured()) return null;
  return cached(
    "vault-index",
    CACHE_MS,
    async () => {
      const notes = await listVaultNotes("", MAX_NOTES);
      const read: { path: string; text: string }[] = [];
      for (const n of notes) {
        try {
          read.push({ path: n.path, text: await readVaultNote(n.path) });
        } catch {
          // One unreadable note must not cost the rest of the vault.
        }
      }
      return indexNotes(read);
    },
    { skipCacheIf: (i) => i.chunks.length === 0 }
  );
}

export const VAULT_CONTEXT_HEADER = [
  "Excerpts from the admin's own Obsidian notes, retrieved for this question.",
  "They are the admin's words about their own setup and plans -- prefer them",
  "over assumptions and cite the note when you use one. If they do not answer",
  "the question, say so.",
];
