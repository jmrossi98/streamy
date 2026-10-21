/**
 * The Obsidian vault as a searchable index for the admin assistant.
 *
 * Same keyword scoring as the repo documentation (docsRetrieval.ts), built
 * here rather than by docs-index.py because the vault lives on mediabox and
 * that index is built on the desktop, where the repos are. Read over WebDAV,
 * chunked by heading, cached for a few minutes so a conversation does not
 * re-read the vault on every message.
 *
 * Reads Word and PDF files as well as notes: the resumes are .docx/.pdf, and
 * a Markdown-only index left the assistant insisting it could see no job
 * history at all. The many saved versions of one resume are collapsed the way
 * the resume builder does it (resumeBankRules.ts) -- one file per name, and an
 * older version only adds the lines no newer one has -- so a search does not
 * come back with the same bullet from twenty files.
 */
import { cached } from "./ttlCache";
import type { DocsIndex } from "./docsRetrieval";
import { isVaultConfigured, listVaultFiles } from "./vault";
import { assembleBank, bankKind, isBankFile, orderBankFiles, pickBankFiles, sourceBlock } from "./resumeBankRules";
import { extractText, loadKnowledgeBase, mapLimit } from "./resume";
import { CAREER_CONTEXT_HEADER, indexNotes } from "./vaultIndexRules";

const CACHE_MS = 5 * 60_000;
const MAX_FILES = 1200;
/** Word/PDF text kept in the index, after de-duplication. */
const MAX_DOC_CHARS = 300_000;

export {
  CLAUDE_MEMORY_CONTEXT_HEADER,
  CLAUDE_MEMORY_DIR,
  VAULT_CONTEXT_HEADER,
  chunkNote,
  indexNotes,
  isClaudeMemoryPath,
  isResumePath,
  splitVaultHits,
} from "./vaultIndexRules";

export async function getVaultIndex(): Promise<DocsIndex | null> {
  if (!isVaultConfigured()) return null;
  return cached(
    "vault-index",
    CACHE_MS,
    async () => {
      const files = await listVaultFiles("", isBankFile, MAX_FILES);
      // Notes are read whole; documents go through the same de-duplication
      // as the resume builder, so twenty saved versions read as one.
      const isNote = (p: string) => bankKind(p) === "md" || bankKind(p) === "txt";
      const notes = files.filter((f) => isNote(f.path));
      const { chosen } = pickBankFiles(files.filter((f) => !isNote(f.path)));
      const docs = orderBankFiles(chosen);

      const readNotes = await mapLimit(notes, 6, async (n) => {
        try {
          return { path: n.path, text: await extractText({ path: n.path, kind: bankKind(n.path)!, modified: n.modified }) };
        } catch {
          // One unreadable note must not cost the rest of the vault.
          return null;
        }
      });
      const readDocs = await mapLimit(docs, 4, async (d) => {
        try {
          return { path: d.path, kind: d.kind, text: await extractText(d) };
        } catch (err) {
          return { path: d.path, kind: d.kind, text: null, error: err instanceof Error ? err.message : String(err) };
        }
      });
      const { sources } = assembleBank(readDocs, MAX_DOC_CHARS);
      return indexNotes([...readNotes.filter((n): n is { path: string; text: string } => n !== null), ...sources]);
    },
    { skipCacheIf: (i) => i.chunks.length === 0 }
  );
}

/**
 * The resume material as one block, for questions about the admin's own
 * career: a summary of their experience needs the whole resume, and keyword
 * search returns three fragments of it. Newest versions and hand-written
 * notes first, so a tight budget cuts the oldest material.
 */
export async function getCareerContext(maxChars: number): Promise<string | null> {
  if (!isVaultConfigured()) return null;
  const kb = await cached("vault-career", CACHE_MS, () => loadKnowledgeBase(), { skipCacheIf: (k) => k.sources.length === 0 });
  if (kb.sources.length === 0) return null;
  let body = "";
  for (const s of kb.sources) {
    const block = sourceBlock(s.path, s.text);
    if (body.length + block.length > maxChars) {
      const room = maxChars - body.length;
      if (room > 500) body += `${block.slice(0, room)}\n[... cut for length]\n`;
      break;
    }
    body += block;
  }
  return body ? [...CAREER_CONTEXT_HEADER, "", body].join("\n") : null;
}

