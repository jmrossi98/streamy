/**
 * Tailored resumes, one per job listing, from the experience bank in the
 * Obsidian vault. See resumeRules.ts for the prompt and its one fixed rule.
 */
import { prisma } from "./db";
import { complete, getRoute } from "./llm";
import { htmlToText } from "./pageWatchRules";
import { assembleBank, isBankFile, orderBankFiles, pickBankFiles, type BankFile, type BankItem } from "./resumeBankRules";
import { buildResumeMessages, MAX_BANK_CHARS, splitResumeOutput, type NoteSource } from "./resumeRules";
import { isVaultConfigured, listVaultFiles, readVaultFile } from "./vault";

/**
 * The vault folders holding the master resume and every experience note.
 * Folder names follow Jake's vault convention: lowercase, dashes for spaces.
 * "resume" is the laptop/Syncthing layout; the phone syncs through Remotely
 * Save, which writes under a folder named after the phone's vault ("main"), so
 * its resume folder arrives as main/resume. A missing folder lists as empty.
 */
export const RESUME_VAULT_DIRS = ["resume", "main/resume"];

export async function listingText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StreamyResume/1.0)" },
      cache: "no-store",
    });
    if (!res.ok) return "";
    return htmlToText(await res.text()).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

/** Plain text from one knowledge-base file. */
async function extractText(file: BankFile): Promise<string> {
  const buf = await readVaultFile(file.path);
  if (file.kind === "md" || file.kind === "txt") return buf.toString("utf8");
  if (file.kind === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await pdfText(pdf, { mergePages: true });
  return text;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export type KnowledgeBase = { sources: NoteSource[]; report: BankItem[]; totalChars: number; maxChars: number };

/**
 * The knowledge base the tailoring prompt is built from: every note, Word file
 * and PDF under the resume folders, read fresh from the vault on each call so
 * whatever the phone or laptop synced last is what gets used.
 */
export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  const entries = (await Promise.all(RESUME_VAULT_DIRS.map((dir) => listVaultFiles(dir, isBankFile, 300)))).flat();
  const { chosen, superseded } = pickBankFiles(entries);
  const ordered = orderBankFiles(chosen);
  const docs = await mapLimit(ordered, 4, async (file) => {
    try {
      return { path: file.path, kind: file.kind, text: await extractText(file) };
    } catch (err) {
      return { path: file.path, kind: file.kind, text: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
  const { sources, report } = assembleBank(docs, MAX_BANK_CHARS);
  return {
    sources,
    report: [...report, ...superseded],
    totalChars: sources.reduce((n, s) => n + s.text.length, 0),
    maxChars: MAX_BANK_CHARS,
  };
}

export type ResumeResult = { ok: true; id: string } | { ok: false; error: string };

export async function generateTailoredResume(postingId: string): Promise<ResumeResult> {
  const route = await getRoute("resume");
  if (!route) return { ok: false, error: "No cloud model is configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)." };
  if (!isVaultConfigured()) return { ok: false, error: "The Obsidian vault is not configured." };

  const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
  if (!posting) return { ok: false, error: "That listing no longer exists." };

  let bank: NoteSource[];
  try {
    bank = (await loadKnowledgeBase()).sources;
  } catch (err) {
    return { ok: false, error: `Could not read the vault: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (bank.length === 0) {
    return {
      ok: false,
      error: `No experience yet: add your master resume and experience notes to a "resume" folder in the Obsidian vault.`,
    };
  }

  const messages = buildResumeMessages(
    {
      company: posting.company,
      title: posting.title,
      location: posting.location,
      url: posting.url,
      postingText: await listingText(posting.url),
    },
    bank
  );
  try {
    const { text, model } = await complete(route, messages, {
      maxTokens: 4096,
      webSearch: true,
      timeoutMs: 240_000,
    });
    const { resume, notes } = splitResumeOutput(text);
    const row = await prisma.resumeVersion.create({
      data: {
        postingId,
        company: posting.company,
        title: posting.title,
        url: posting.url,
        markdown: resume,
        notes,
        model,
      },
    });
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: `The model call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function listResumeVersions(limit = 100) {
  return prisma.resumeVersion.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, postingId: true, company: true, title: true, url: true, model: true, createdAt: true },
  });
}
