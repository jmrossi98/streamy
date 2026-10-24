/**
 * Choosing and trimming the resume knowledge base: which vault files feed the
 * tailoring prompt, in what order, and how much of each. Pure; the reading
 * lives in resume.ts.
 *
 * The vault holds hand-written notes alongside many saved resume versions, as
 * Word files and PDF exports of the same Word files. Sending all of them would
 * repeat the same bullets twenty times and push the notes past the size cap,
 * so: one file per name (a PDF export loses to its Word original), notes
 * first, newest versions next, and an older version only contributes the
 * lines no earlier source already had.
 */
import type { NoteSource } from "./resumeRules";
import { isSafeVaultPath } from "./vaultRules";

/**
 * The vault folders holding the master resume and every experience note.
 * Folder names follow Jake's vault convention: lowercase, dashes for spaces.
 * "resume" is the laptop/Syncthing layout; the phone syncs through Remotely
 * Save, which writes under a folder named after the phone's vault ("main"), so
 * its resume folder arrives as main/resume. A missing folder lists as empty.
 */
export const RESUME_VAULT_DIRS = ["resume", "main/resume"];

export type BankKind = "md" | "txt" | "docx" | "pdf";

/** Preference when one folder holds the same name in several formats. */
const KIND_RANK: Record<BankKind, number> = { md: 0, txt: 1, docx: 2, pdf: 3 };

export function bankKind(path: string): BankKind | null {
  const m = /\.(md|txt|docx|pdf)$/i.exec(path);
  return m ? (m[1].toLowerCase() as BankKind) : null;
}

/**
 * Notes in the resume folders that are instructions, not experience
 * (2026-10-24): the correction rules and the style guide. Loaded on every
 * tailoring as guidance (resume.ts loadGuidance) and never put in the bank,
 * where "never call it a four-epic program" would read as a fact to use.
 */
export const RESUME_RULES_FILE = "resume-rules.md";
export const RESUME_STYLE_GUIDE_FILE = "resume-style-guide.md";

export function isGuidanceFile(path: string): boolean {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  return name === RESUME_RULES_FILE || name === RESUME_STYLE_GUIDE_FILE;
}

/** Where the rules note may live, preferred first: main/ is what the phone and laptop sync. */
export function guidancePaths(file: string): string[] {
  return [...RESUME_VAULT_DIRS].reverse().map((dir) => `${dir}/${file}`);
}

/**
 * Jake's own hand-written resumes, the voice exemplars' source (2026-10-24):
 * the current one, and the 2025 one that landed Capital One. Matched by path
 * suffix under the resume folders, so a move between resume/ and
 * main/resume/ doesn't lose them.
 */
export const VOICE_SOURCE_SUFFIXES = ["resume/jakob_rossi_resume.docx", "mastodon-results/jakob_rossi_resume_02_17_2025.docx"];

export function voiceSourcePaths(paths: string[]): string[] {
  return VOICE_SOURCE_SUFFIXES.map((suffix) =>
    paths.find((p) => p.toLowerCase() === suffix || p.toLowerCase().endsWith(`/${suffix}`))
  ).filter((p): p is string => !!p);
}

export function isBankFile(path: string): boolean {
  return isSafeVaultPath(path) && bankKind(path) !== null && !isGuidanceFile(path);
}

export type BankFile = { path: string; kind: BankKind; modified: string | null };

export type BankStatus = "included" | "partial" | "duplicate" | "superseded" | "unreadable" | "over-budget" | "empty";

export type BankItem = {
  path: string;
  kind: BankKind;
  status: BankStatus;
  /** Characters this file contributes to the prompt (0 unless included or partial). */
  chars: number;
  detail?: string;
};

function stem(path: string): string {
  return path.replace(/\.[^./]+$/, "").toLowerCase();
}

/** One file per folder and name, preferring the most editable format. */
export function pickBankFiles(entries: { path: string; modified: string | null }[]): {
  chosen: BankFile[];
  superseded: BankItem[];
} {
  const best = new Map<string, BankFile>();
  const superseded: BankItem[] = [];
  for (const e of entries) {
    const kind = bankKind(e.path);
    if (!kind || !isSafeVaultPath(e.path)) continue;
    const file: BankFile = { path: e.path, kind, modified: e.modified };
    const key = stem(e.path);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, file);
      continue;
    }
    const [keep, drop] = KIND_RANK[kind] < KIND_RANK[prev.kind] ? [file, prev] : [prev, file];
    best.set(key, keep);
    superseded.push({ path: drop.path, kind: drop.kind, status: "superseded", chars: 0, detail: `same document as ${keep.path}` });
  }
  return { chosen: [...best.values()], superseded };
}

/**
 * A date written into a filename ("resume_2_6_2024", "resume_06_23_2024",
 * "resume_12-02-2025"), as epoch ms; otherwise the file's modified time; else 0.
 */
export function fileDate(path: string, modified: string | null): number {
  const name = path.split("/").pop() ?? path;
  const m = /(?:^|[^\d])(\d{1,2})[_-](\d{1,2})[_-](\d{4})(?!\d)/.exec(name);
  if (m) {
    const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return Date.UTC(y, mo - 1, d);
  }
  const t = modified ? Date.parse(modified) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Hand-written notes first, then everything else newest first. */
export function orderBankFiles(files: BankFile[]): BankFile[] {
  const isNote = (f: BankFile) => f.kind === "md" || f.kind === "txt";
  return [...files].sort(
    (a, b) =>
      Number(isNote(b)) - Number(isNote(a)) ||
      Number(/master/i.test(b.path)) - Number(/master/i.test(a.path)) ||
      fileDate(b.path, b.modified) - fileDate(a.path, a.modified) ||
      a.path.localeCompare(b.path)
  );
}

/** A line's identity for de-duplication: case, spacing, bullets and punctuation ignored. */
export function lineKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$+#]+/gu, " ")
    .trim();
}

/** Lines shorter than this many words ("Skills", "Python") repeat legitimately and never de-duplicate. */
const MIN_KEY_WORDS = 4;
export function sourceBlock(path: string, text: string): string {
  return `--- ${path} ---\n${text.trim()}\n\n`;
}

/**
 * Builds the bank from extracted documents, already in priority order. The
 * first document with text is kept whole; each later one keeps only lines not
 * seen before, and is dropped as a duplicate when it has none.
 */
export function assembleBank(
  docs: { path: string; kind: BankKind; text: string | null; error?: string }[],
  maxChars: number
): { sources: NoteSource[]; report: BankItem[] } {
  const seen = new Set<string>();
  const sources: NoteSource[] = [];
  const report: BankItem[] = [];
  let used = 0;
  for (const doc of docs) {
    if (doc.text === null) {
      report.push({ path: doc.path, kind: doc.kind, status: "unreadable", chars: 0, detail: doc.error });
      continue;
    }
    const lines = doc.text.split(/\r?\n/).map((l) => l.trimEnd());
    if (!lines.some((l) => l.trim())) {
      report.push({ path: doc.path, kind: doc.kind, status: "empty", chars: 0, detail: "no text could be extracted" });
      continue;
    }
    const first = sources.length === 0;
    const novel = lines.filter((l) => {
      const k = lineKey(l);
      return k.split(" ").length >= MIN_KEY_WORDS && !seen.has(k);
    });
    let text: string;
    let status: BankStatus;
    if (first) {
      text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
      status = "included";
    } else {
      // Any new line keeps the source: one bullet that only an old version
      // has is exactly what this is here to preserve.
      if (novel.length === 0) {
        report.push({ path: doc.path, kind: doc.kind, status: "duplicate", chars: 0, detail: "everything in it is already in a source above" });
        continue;
      }
      const whole = novel.length === lines.filter((l) => lineKey(l).split(" ").length >= MIN_KEY_WORDS).length;
      text = whole
        ? lines.join("\n").replace(/\n{3,}/g, "\n\n")
        : `(Only the lines not already in a source above.)\n${novel.join("\n")}`;
      status = whole ? "included" : "partial";
    }
    const block = sourceBlock(doc.path, text);
    if (used + block.length > maxChars) {
      report.push({ path: doc.path, kind: doc.kind, status: "over-budget", chars: 0, detail: "the knowledge base is full" });
      continue;
    }
    for (const l of lines) {
      const k = lineKey(l);
      if (k.split(" ").length >= MIN_KEY_WORDS) seen.add(k);
    }
    used += block.length;
    sources.push({ path: doc.path, text });
    report.push({ path: doc.path, kind: doc.kind, status, chars: text.length });
  }
  return { sources, report };
}
