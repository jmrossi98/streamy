/**
 * Tailored resumes, one per job listing, from the experience bank in the
 * Obsidian vault. See resumeRules.ts for the prompt and its one fixed rule.
 */
import { prisma } from "./db";
import { complete, getRoute } from "./llm";
import { htmlToText } from "./pageWatchRules";
import { renderListing } from "./listingRender";
import { budgetFor, LISTING_UNREAD_NOTE, needsRender, pickListingText, resumeLog, type ResumeJobStep } from "./resumeJobRules";
import {
  assembleBank,
  bankKind,
  guidancePaths,
  isBankFile,
  RESUME_RULES_FILE,
  RESUME_STYLE_GUIDE_FILE,
  RESUME_VAULT_DIRS,
  orderBankFiles,
  pickBankFiles,
  voiceSourcePaths,
  type BankFile,
  type BankItem,
} from "./resumeBankRules";
import {
  checkResumeFormat,
  classifyRoleType,
  formatIssuesBlock,
  formatIssuesNote,
  parseResumeRules,
  pickVoiceExemplars,
} from "./resumeFormatRules";
import {
  buildResumeMessages,
  buildReviewMessages,
  MAX_BANK_CHARS,
  profileLocation,
  splitResumeOutput,
  withProfileHeader,
  type NoteSource,
  type PostingInput,
  type TailoringGuidance,
} from "./resumeRules";
import { isVaultConfigured, listVaultFiles, readVaultFile, readVaultNoteVersioned } from "./vault";
import type { VaultEntry } from "./vaultRules";

export { RESUME_VAULT_DIRS } from "./resumeBankRules";

/** The listing as text from a plain fetch; "" when it can't be read. */
async function fetchListingText(url: string): Promise<string> {
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

export type ListingRead = { text: string; source: "fetch" | "render" | "none" };

/**
 * The listing as text. A plain fetch first; when that comes back empty or a
 * JS shell (under ~500 characters of real text) and the site is one mediabox's
 * browser will open, a render there.
 *
 * 2026-10-24: Meta's job pages return HTTP 400 to the fetch, so tailoring to a
 * Meta posting ran blind; the render reads its responsibilities and
 * qualifications in about 8 s.
 */
export async function readListing(url: string): Promise<ListingRead> {
  let t = Date.now();
  const fetched = await fetchListingText(url);
  const host = URL.canParse(url) ? new URL(url).hostname : "?";
  console.log(resumeLog("listing.fetch", Date.now() - t, { host, chars: fetched.length }));
  if (!needsRender(fetched, url)) return pickListingText(fetched, null);
  t = Date.now();
  const rendered = await renderListing(url);
  console.log(
    resumeLog("listing.render", Date.now() - t, "text" in rendered ? { host, chars: rendered.text.length } : { host, error: rendered.error })
  );
  return pickListingText(fetched, "text" in rendered ? rendered.text : null);
}

export async function listingText(url: string): Promise<string> {
  return (await readListing(url)).text;
}

/**
 * Extracted text by path and modified time. Word and PDF extraction is the
 * slow part of reading the vault, and the assistant reads it far more often
 * than the files change; a file saved again gets a new modified time and is
 * read fresh.
 */
const extracted = new Map<string, string>();
const MAX_EXTRACTED = 1000;

/** Plain text from one vault file (Markdown, text, Word or PDF). */
export async function extractText(file: BankFile): Promise<string> {
  const key = file.modified ? `${file.path}|${file.modified}` : null;
  const hit = key ? extracted.get(key) : undefined;
  if (hit !== undefined) return hit;
  const text = await extractUncached(file);
  if (key) {
    if (extracted.size >= MAX_EXTRACTED) extracted.clear();
    extracted.set(key, text);
  }
  return text;
}

async function extractUncached(file: BankFile): Promise<string> {
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

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export type KnowledgeBase = {
  sources: NoteSource[];
  report: BankItem[];
  totalChars: number;
  maxChars: number;
  /** Every bank file listed, for finding the voice resumes without listing again. */
  entries: VaultEntry[];
};

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
    entries,
  };
}

/** The first of a guidance note's places that exists, with its path. */
async function readGuidanceNote(file: string): Promise<{ path: string; text: string } | null> {
  for (const path of guidancePaths(file)) {
    try {
      const note = await readVaultNoteVersioned(path);
      if (note) return { path, text: note.text };
    } catch {
      // Unreadable here; try the other folder.
    }
  }
  return null;
}

export type LoadedGuidance = {
  guidance: TailoringGuidance;
  rulesPath: string | null;
  styleGuidePath: string | null;
  voicePaths: string[];
};

/**
 * The vault guidance for one tailoring (2026-10-24): the rules note (hard
 * constraints), the style guide, 3-4 of Jake's own bullets as the voice, and
 * the posting's role type. Read fresh each time, so an edit in Obsidian or
 * on the Jobs tab applies to the next resume. A missing piece is left out
 * rather than failing the run.
 */
export async function loadGuidance(entries: VaultEntry[], title: string): Promise<LoadedGuidance> {
  const voicePaths = voiceSourcePaths(entries.map((e) => e.path));
  const [rules, guide, voiceTexts] = await Promise.all([
    readGuidanceNote(RESUME_RULES_FILE),
    readGuidanceNote(RESUME_STYLE_GUIDE_FILE),
    Promise.all(
      voicePaths.map((path) => {
        const kind = bankKind(path);
        const modified = entries.find((e) => e.path === path)?.modified ?? null;
        return kind ? extractText({ path, kind, modified }).catch(() => "") : Promise.resolve("");
      })
    ),
  ]);
  return {
    guidance: {
      rules: rules ? parseResumeRules(rules.text) : [],
      styleGuide: guide?.text ?? "",
      exemplars: pickVoiceExemplars(voiceTexts.filter(Boolean), 4),
      roleType: classifyRoleType(title),
    },
    rulesPath: rules?.path ?? null,
    styleGuidePath: guide?.path ?? null,
    voicePaths,
  };
}

/** What the run was guided by, for the notes. */
function guidanceNote(g: LoadedGuidance): string {
  return [
    "**Guidance**",
    `- Role type: ${g.guidance.roleType}.`,
    g.rulesPath ? `- Rules: ${g.guidance.rules.length} from ${g.rulesPath}.` : "- Rules: no resume-rules.md found in the vault.",
    g.styleGuidePath ? `- Style guide: ${g.styleGuidePath}.` : "- Style guide: no resume-style-guide.md found in the vault.",
    g.guidance.exemplars.length > 0
      ? `- Voice: ${g.guidance.exemplars.length} of your own bullets from ${g.voicePaths.join(", ")}.`
      : "- Voice: your hand-written resumes weren't found, so no exemplars.",
  ].join("\n");
}

export type ResumeResult = { ok: true; id: string; note: string | null } | { ok: false; error: string };

export type TailorOptions = {
  /** Called as each step starts; resumeJobs.ts records it on the job row. */
  onStep?: (step: ResumeJobStep) => Promise<void> | void;
  /** When the job started, for the overall cap (JOB_CAP_MS). Defaults to now. */
  startedAt?: number;
};

/**
 * Each model call's own ceiling; the job's 10-minute cap binds as well.
 *
 * 2026-10-24: one ceiling of 300 s for both, until #528 made it a real
 * deadline (the SDK used to retry past it). The Meta "Software Engineer,
 * Systems" draft then timed out at 300 s: researched drafts measured 157-300+
 * s. The draft gets 7 minutes; the review whatever is left (and is skipped,
 * keeping the draft, when that is too little).
 */
const DRAFT_MAX_MS = 420_000;
const REVIEW_MAX_MS = 300_000;
const REVIEW_MAX_TOKENS = 40_000;

export async function generateTailoredResume(postingId: string, opts: TailorOptions = {}): Promise<ResumeResult> {
  const startedAt = opts.startedAt ?? Date.now();
  let stepStart = Date.now();
  let current = "setup";
  const step = async (next: ResumeJobStep) => {
    console.log(resumeLog(current, Date.now() - stepStart, { posting: postingId }));
    current = next;
    stepStart = Date.now();
    await opts.onStep?.(next);
  };
  const route = await getRoute("resume");
  if (!route) return { ok: false, error: "No cloud model is configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)." };
  if (!isVaultConfigured()) return { ok: false, error: "The Obsidian vault is not configured." };

  const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
  if (!posting) return { ok: false, error: "That listing no longer exists." };

  let bank: NoteSource[];
  let entries: VaultEntry[];
  try {
    const kb = await loadKnowledgeBase();
    bank = kb.sources;
    entries = kb.entries;
  } catch (err) {
    return { ok: false, error: `Could not read the vault: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (bank.length === 0) {
    return {
      ok: false,
      error: `No experience yet: add your master resume and experience notes to a "resume" folder in the Obsidian vault.`,
    };
  }

  // The header's name, location and contact details (resumeRules.profileHeader).
  // Imported here: applyPacket imports this module.
  const profile = await (await import("./applyPacket")).getApplicantProfile();

  const loaded = await loadGuidance(entries, posting.title);
  const guidance = loaded.guidance;

  await step("Reading the listing");
  const listing = await readListing(posting.url);
  const note = listing.source === "none" ? LISTING_UNREAD_NOTE : null;
  const input: PostingInput = {
    company: posting.company,
    title: posting.title,
    location: posting.location,
    url: posting.url,
    postingText: listing.text,
    candidateLocation: profileLocation(profile),
  };
  try {
    // Two passes. The draft researches the company and writes; the review
    // reads the draft as the parser, the recruiter and the hiring manager
    // would, checks every claim against the bank, and tightens it to a page.
    // A failed review keeps the draft rather than failing the whole thing.
    await step("Researching and drafting");
    const draftBudget = budgetFor(startedAt, Date.now(), DRAFT_MAX_MS);
    if (draftBudget < 30_000) return { ok: false, error: "Ran out of time before drafting (10-minute limit) — tap Tailor again." };
    const draft = await complete(route, buildResumeMessages(input, bank, guidance), {
      maxTokens: 24_000,
      webSearch: true,
      timeoutMs: draftBudget,
      effort: "high",
    });
    let { resume, notes } = splitResumeOutput(draft.text);
    let model = draft.model;
    // Whatever is left of the 10 minutes; too little and the draft is kept
    // unreviewed rather than thrown away.
    const reviewBudget = budgetFor(startedAt, Date.now(), REVIEW_MAX_MS);
    if (resume.trim() && reviewBudget < 30_000) {
      notes += "\n\n**Review**\n- Skipped: the draft used up the 10-minute limit; this is the unreviewed draft.";
    } else if (resume.trim()) {
      await step("Reviewing");
      try {
        // Counted here, not by the model: the review is told exactly which
        // bullets are over a limit (resumeFormatRules.checkResumeFormat).
        const formatCheck = formatIssuesBlock(checkResumeFormat(resume, guidance.roleType));
        // 2026-10-24: the first review with the rules, style guide and
        // specificity rubric spent all 28k output tokens reasoning (Meta
        // "Software Engineer (Technical Leadership)") and wrote nothing, so the
        // draft went out unreviewed. More room, and medium effort: the review
        // is a checklist against a finished draft, and it has only what is
        // left of the 10 minutes after a ~6-minute researched draft.
        const review = await complete(route, buildReviewMessages(input, bank, { resume, notes }, guidance, formatCheck), {
          maxTokens: REVIEW_MAX_TOKENS,
          timeoutMs: reviewBudget,
          effort: "medium",
        });
        const revised = splitResumeOutput(review.text);
        // No H1 required: the header is the profile's, added below.
        if (/##\s+Experience/i.test(revised.resume)) {
          resume = revised.resume;
          notes = revised.notes || notes;
          model = review.model === draft.model ? draft.model : `${draft.model} + ${review.model}`;
        }
      } catch (err) {
        notes += `\n\n**Review**\n- The review pass failed (${err instanceof Error ? err.message : String(err)}); this is the unreviewed draft.`;
      }
    }
    await step("Saving");
    notes += `\n\n${formatIssuesNote(checkResumeFormat(resume, guidance.roleType))}\n\n${guidanceNote(loaded)}`;
    if (note) notes = `**Listing**\n- ${note}.\n\n${notes}`;
    // Whatever header either pass wrote, the saved profile's replaces it.
    resume = withProfileHeader(resume, profile);
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
    console.log(resumeLog(current, Date.now() - stepStart, { posting: postingId }));
    console.log(resumeLog("total", Date.now() - startedAt, { posting: postingId, listing: listing.source }));
    return { ok: true, id: row.id, note };
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
