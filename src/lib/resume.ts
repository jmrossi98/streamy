/**
 * Tailored resumes, one per job listing, from the experience bank in the
 * Obsidian vault. See resumeRules.ts for the prompt and its one fixed rule.
 */
import { prisma } from "./db";
import { completeOpenRouter, isOpenRouterConfigured, modelChain } from "./openrouter";
import { htmlToText } from "./pageWatchRules";
import { buildResumeMessages, splitResumeOutput, type NoteSource } from "./resumeRules";
import { isVaultConfigured, listVaultNotes, readVaultNote } from "./vault";

/** The vault folder holding the master resume and every experience note. */
export const RESUME_VAULT_DIR = "Resume";

async function listingText(url: string): Promise<string> {
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

async function experienceBank(): Promise<NoteSource[]> {
  const notes = await listVaultNotes(RESUME_VAULT_DIR, 200);
  // The master resume first, so it survives the size cap whatever else is there.
  notes.sort((a, b) => Number(/master/i.test(b.path)) - Number(/master/i.test(a.path)) || a.path.localeCompare(b.path));
  const out: NoteSource[] = [];
  for (const n of notes) out.push({ path: n.path, text: await readVaultNote(n.path) });
  return out;
}

export type ResumeResult = { ok: true; id: string } | { ok: false; error: string };

export async function generateTailoredResume(postingId: string): Promise<ResumeResult> {
  if (!isOpenRouterConfigured()) return { ok: false, error: "OpenRouter is not configured." };
  if (!isVaultConfigured()) return { ok: false, error: "The Obsidian vault is not configured." };

  const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
  if (!posting) return { ok: false, error: "That listing no longer exists." };

  let bank: NoteSource[];
  try {
    bank = await experienceBank();
  } catch (err) {
    return { ok: false, error: `Could not read the vault: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (bank.every((n) => !n.text.trim())) {
    return {
      ok: false,
      error: `No experience yet: add your master resume and experience notes to the "${RESUME_VAULT_DIR}" folder in the Obsidian vault.`,
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
    const { text, model } = await completeOpenRouter(messages, {
      models: modelChain("claude"),
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
