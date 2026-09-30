/**
 * Apply packets: everything one application needs, prepared ahead of opening
 * the form -- the tailored resume and an answer for every question the form
 * asks. See applyAnswerRules.ts for who answers what.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { fetchApplicationForm } from "./applyForms";
import { applyTargetFromPostingId, applyUrl, type ApplyTarget } from "./applyFormRules";
import {
  applyModelAnswers,
  buildAnswerMessages,
  normalizeProfile,
  parseAnswerJson,
  planAnswers,
  type Answer,
  type ApplicantProfile,
} from "./applyAnswerRules";
import { completeOpenRouter, isOpenRouterConfigured, modelChain } from "./openrouter";
import { generateTailoredResume, listingText } from "./resume";

const PROFILE_KEY = "job_applicant_profile";
const TOKEN_KEY = "job_apply_token";

export async function getApplicantProfile(): Promise<ApplicantProfile> {
  const row = await prisma.setting.findUnique({ where: { key: PROFILE_KEY } }).catch(() => null);
  try {
    return normalizeProfile(row ? JSON.parse(row.value) : {});
  } catch {
    return normalizeProfile({});
  }
}

export async function setApplicantProfile(raw: unknown): Promise<ApplicantProfile> {
  const profile = normalizeProfile(raw);
  const value = JSON.stringify(profile);
  await prisma.setting.upsert({ where: { key: PROFILE_KEY }, create: { key: PROFILE_KEY, value }, update: { value } });
  return profile;
}

/**
 * The userscript's credential. A random token rather than the session cookie:
 * the script runs on greenhouse.io / ashbyhq.com, where Streamy's cookie is
 * (rightly) never sent. Created on first use; rotating it breaks the old script.
 */
export async function getApplyToken(rotate = false): Promise<string> {
  if (!rotate) {
    const row = await prisma.setting.findUnique({ where: { key: TOKEN_KEY } });
    if (row?.value) return row.value;
  }
  const value = randomBytes(24).toString("base64url");
  await prisma.setting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } });
  return value;
}

export async function isValidApplyToken(presented: string | null): Promise<boolean> {
  if (!presented) return false;
  const row = await prisma.setting.findUnique({ where: { key: TOKEN_KEY } }).catch(() => null);
  if (!row?.value) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(row.value);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PacketResult = { ok: true; id: string } | { ok: false; error: string };

/** The newest tailored resume for a posting, generating one if there is none. */
async function resumeFor(postingId: string): Promise<{ id: string; markdown: string } | null> {
  const existing = await prisma.resumeVersion.findFirst({
    where: { postingId },
    orderBy: { createdAt: "desc" },
    select: { id: true, markdown: true },
  });
  if (existing) return existing;
  const made = await generateTailoredResume(postingId);
  if (!made.ok) return null;
  return prisma.resumeVersion.findUnique({ where: { id: made.id }, select: { id: true, markdown: true } });
}

export async function prepareApplication(postingId: string): Promise<PacketResult> {
  const target = applyTargetFromPostingId(postingId);
  if (!target) {
    return { ok: false, error: "Auto-apply covers Greenhouse and Ashby boards; this listing is on another system." };
  }
  const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
  if (!posting) return { ok: false, error: "That listing no longer exists." };

  const profile = await getApplicantProfile();
  if (!profile.firstName || !profile.email) {
    return { ok: false, error: "Fill in your applicant profile first (name and email at least)." };
  }

  let fields;
  try {
    fields = await fetchApplicationForm(target);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read the application form." };
  }

  const [resume, postingText] = await Promise.all([resumeFor(postingId), listingText(posting.url)]);
  let { answers, forModel } = planAnswers(fields, profile);
  if (!resume) {
    answers = answers.map((a) => (a.fileRole === "resume" ? { ...a, value: null, display: undefined, source: "you" } : a));
  }

  if (forModel.length > 0 && isOpenRouterConfigured()) {
    try {
      const { text } = await completeOpenRouter(
        buildAnswerMessages(forModel, profile, resume?.markdown ?? "", {
          company: posting.company,
          title: posting.title,
          location: posting.location,
          text: postingText,
        }),
        { models: modelChain("claude"), maxTokens: 4096, timeoutMs: 180_000 }
      );
      answers = applyModelAnswers(answers, parseAnswerJson(text));
    } catch (err) {
      console.error("[apply] answer drafting failed:", err);
    }
  }
  // Whatever the model did not answer, a required field is the applicant's.
  answers = answers.map((a) => (a.source === "none" && a.required ? { ...a, source: "you" } : a));

  const row = await prisma.jobApplication.create({
    data: {
      postingId,
      company: posting.company,
      title: posting.title,
      provider: target.provider,
      boardSlug: target.slug,
      jobId: target.jobId,
      applyUrl: applyUrl(target),
      resumeVersionId: resume?.id ?? null,
      answers: JSON.stringify(answers),
    },
  });
  return { ok: true, id: row.id };
}

export function parseAnswers(json: string): Answer[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as Answer[]) : [];
  } catch {
    return [];
  }
}

/** The newest packet for the job a page belongs to. */
export async function packetForTarget(target: ApplyTarget) {
  return prisma.jobApplication.findFirst({
    where: { provider: target.provider, boardSlug: target.slug, jobId: target.jobId },
    orderBy: { createdAt: "desc" },
  });
}

/** Edits from the review screen: only values of existing keys change. */
export async function updateAnswers(id: string, edits: Record<string, unknown>): Promise<Answer[] | null> {
  const row = await prisma.jobApplication.findUnique({ where: { id } });
  if (!row) return null;
  const answers = parseAnswers(row.answers).map((a) => {
    if (!(a.key in edits)) return a;
    const v = edits[a.key];
    if (a.kind === "boolean") return { ...a, value: v === true || v === "true", display: v === true || v === "true" ? "Yes" : "No", source: "profile" as const };
    if (a.kind === "select" || a.kind === "multiselect") {
      const opt = (a.options ?? []).find((o) => o.value === v || o.label === v);
      return opt ? { ...a, value: a.kind === "multiselect" ? [opt.value] : opt.value, display: opt.label, source: "profile" as const } : a;
    }
    return { ...a, value: typeof v === "string" ? v.slice(0, 8000) : a.value, source: typeof v === "string" && v ? ("profile" as const) : a.source };
  });
  await prisma.jobApplication.update({ where: { id }, data: { answers: JSON.stringify(answers) } });
  return answers;
}

export async function markSubmitted(id: string): Promise<void> {
  await prisma.jobApplication.update({ where: { id }, data: { status: "submitted", submittedAt: new Date() } });
}
