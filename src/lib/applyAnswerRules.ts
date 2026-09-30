/**
 * Which answer each application field gets, before any model is asked. Pure.
 *
 * Three kinds of field, decided in this order:
 *   - YOURS: acknowledgements, certifications, arbitration and privacy consent.
 *     Agreeing to terms is the applicant's act; these are never pre-ticked.
 *   - PROFILE: identity, contact, links, work authorisation, sponsorship,
 *     demographics (declined unless the profile says otherwise). Deterministic,
 *     so the same question gets the same answer on every application.
 *   - AI: everything else -- "why us", screening questions, multi-option
 *     selects the profile can't map -- drafted from the resume and the profile,
 *     and flagged for review.
 */
import type { FormField, FormOption } from "./applyFormRules";

export type ApplicantProfile = {
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  linkedin: string;
  github: string;
  website: string;
  /** "yes" | "no" | "" (unset). Strings so the form round-trips cleanly. */
  workAuthorizedUS: string;
  needsSponsorship: string;
  willingToRelocate: string;
  /** Free text: "2 weeks after an offer". */
  earliestStart: string;
  salaryExpectation: string;
  /** Default answer to "how did you hear about us". */
  howHeard: string;
  /** Decline every demographic question. On by default. */
  declineDemographics: boolean;
  /** Anything else true that answers might need: clearance, degree, languages. */
  extraFacts: string;
};

export const EMPTY_PROFILE: ApplicantProfile = {
  firstName: "",
  lastName: "",
  preferredName: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  country: "United States",
  linkedin: "",
  github: "",
  website: "",
  workAuthorizedUS: "",
  needsSponsorship: "",
  willingToRelocate: "",
  earliestStart: "",
  salaryExpectation: "",
  howHeard: "Company website",
  declineDemographics: true,
  extraFacts: "",
};

export function normalizeProfile(raw: unknown): ApplicantProfile {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...EMPTY_PROFILE };
  for (const key of Object.keys(EMPTY_PROFILE) as (keyof ApplicantProfile)[]) {
    const v = src[key];
    if (key === "declineDemographics") out.declineDemographics = v === undefined ? true : Boolean(v);
    else if (typeof v === "string") (out[key] as string) = v.trim().slice(0, key === "extraFacts" ? 4000 : 300);
  }
  return out;
}

export type AnswerSource = "profile" | "resume" | "ai" | "you" | "none";

export type Answer = {
  key: string;
  label: string;
  kind: FormField["kind"];
  required: boolean;
  /** Text, one option value, several option values, a boolean, or nothing. */
  value: string | string[] | boolean | null;
  /** For a select, the chosen option's label -- what the viewer and the DOM show. */
  display?: string;
  source: AnswerSource;
  options?: FormOption[];
  fileRole?: FormField["fileRole"];
  demographic?: boolean;
};

const CONSENT =
  /acknowledg|\bi (hereby )?certify|\bi confirm|\bi agree|\bconsent\b|privacy (policy|notice)|arbitration|terms (and|&) conditions|double-check|by submitting|attest/i;
const DEMOGRAPHIC =
  /gender|\brace\b|ethnic|hispanic|latin[oax]|veteran|disabilit|sexual orientation|transgender|pronoun/i;
const DECLINE = /decline|don.?t wish|do not wish|prefer not|choose not|not to (answer|disclose|say)|i don.?t want/i;

function pick(options: FormOption[], re: RegExp): FormOption | null {
  return options.find((o) => re.test(o.label)) ?? null;
}

function yesNo(field: FormField, answer: string): Pick<Answer, "value" | "display"> | null {
  if (answer !== "yes" && answer !== "no") return null;
  if (field.kind === "boolean") return { value: answer === "yes", display: answer === "yes" ? "Yes" : "No" };
  if (field.kind === "select" || field.kind === "multiselect") {
    const opt = pick(field.options, answer === "yes" ? /^\s*yes\b/i : /^\s*no\b/i);
    if (!opt) return null;
    return { value: field.kind === "multiselect" ? [opt.value] : opt.value, display: opt.label };
  }
  return { value: answer === "yes" ? "Yes" : "No" };
}

function text(value: string): Pick<Answer, "value"> | null {
  return value ? { value } : null;
}

/**
 * The profile's answer for one field, or null when the field is not the
 * profile's to answer (it goes to the model, or to the applicant).
 */
export function profileAnswer(field: FormField, p: ApplicantProfile): Pick<Answer, "value" | "display" | "source"> | null {
  const label = field.label.toLowerCase();
  const key = field.key.toLowerCase();
  const as = (r: Pick<Answer, "value" | "display"> | null, source: AnswerSource = "profile") =>
    r ? { ...r, source } : null;

  if (field.kind === "file") {
    if (field.fileRole === "resume") return { value: "resume", display: "Tailored resume (PDF)", source: "resume" };
    return null; // A cover letter is drafted, and only if required.
  }

  if (field.demographic || DEMOGRAPHIC.test(label)) {
    if (!p.declineDemographics) return { value: null, source: "you" };
    const opt = pick(field.options, DECLINE);
    if (opt) return { value: field.kind === "multiselect" ? [opt.value] : opt.value, display: opt.label, source: "profile" };
    return { value: null, source: field.required ? "you" : "none" };
  }

  if (key === "first_name" || /^(legal )?first name/.test(label)) return as(text(p.firstName));
  if (key === "last_name" || /^(legal )?(last|family) name|^surname/.test(label)) return as(text(p.lastName));
  if (key === "_systemfield_name" || /^(full |legal )?name$|^full legal name/.test(label))
    return as(text([p.firstName, p.lastName].filter(Boolean).join(" ")));
  if (/preferred (first )?name/.test(label)) return p.preferredName ? as(text(p.preferredName)) : { value: null, source: "none" };
  if (field.kind === "email" || key === "email" || /^e-?mail/.test(label)) return as(text(p.email));
  if (field.kind === "phone" || key === "phone" || /phone/.test(label)) return as(text(p.phone));
  if (/linkedin/.test(label)) return as(text(p.linkedin));
  if (/github/.test(label)) return as(text(p.github));
  if (/twitter|\bx\.com\b/.test(label)) return { value: null, source: "none" };
  if (/website|portfolio|personal (site|url)/.test(label)) return as(text(p.website || p.github));

  const place = [p.city, p.state].filter(Boolean).join(", ");
  if (field.kind === "location" || /where are you (currently )?(located|based)|current (city|location)|^location$|^city$/.test(label)) {
    if (field.kind === "select") return null; // "Which of these countries..." -- the model reads the list.
    return as(text(place));
  }
  if (/sponsor/.test(label)) return as(yesNo(field, p.needsSponsorship));
  if (/authori[sz]ed to work|work authori[sz]ation|legally (eligible|authori[sz]ed)|eligible to work/.test(label)) {
    // A yes/no is the profile's; "which of these statuses" goes to the model.
    return as(yesNo(field, p.workAuthorizedUS));
  }
  if (/relocat/.test(label)) return as(yesNo(field, p.willingToRelocate));
  if (/how did you (hear|find|learn)|where did you (first )?(hear|find|see|learn)|referral source|source of application/.test(label)) {
    if (field.options.length === 0) return as(text(p.howHeard));
    const wanted = p.howHeard.toLowerCase();
    const opt =
      field.options.find((o) => o.label.toLowerCase() === wanted) ??
      pick(field.options, /company (website|site|careers)|careers? (page|site)|website/i) ??
      pick(field.options, /job board|linkedin|other/i);
    return opt ? { value: field.kind === "multiselect" ? [opt.value] : opt.value, display: opt.label, source: "profile" } : null;
  }
  if (/salary|compensation (expectation|requirement)|desired (pay|compensation)|expected (pay|compensation)/.test(label)) {
    return p.salaryExpectation && field.kind !== "select" ? as(text(p.salaryExpectation)) : { value: null, source: "you" };
  }
  if (field.kind !== "date" && /when can you start|earliest start|start date|notice period|availability to start/.test(label)) {
    return p.earliestStart ? as(text(p.earliestStart)) : null;
  }
  return null;
}

/** First pass over a form: profile and consent answers, and what is left for the model. */
export function planAnswers(fields: FormField[], profile: ApplicantProfile): { answers: Answer[]; forModel: FormField[] } {
  const answers: Answer[] = [];
  const forModel: FormField[] = [];
  for (const field of fields) {
    const base: Answer = {
      key: field.key,
      label: field.label,
      kind: field.kind,
      required: field.required,
      value: null,
      source: "none",
      options: field.options.length ? field.options : undefined,
      fileRole: field.fileRole ?? null,
      demographic: field.demographic,
    };
    if (CONSENT.test(field.label)) {
      answers.push({ ...base, source: "you" });
      continue;
    }
    const fromProfile = profileAnswer(field, profile);
    if (fromProfile) {
      answers.push({ ...base, ...fromProfile });
      continue;
    }
    if (field.kind === "file" && !field.required) {
      answers.push(base); // An optional cover letter file: skipped.
      continue;
    }
    if (field.kind === "date") {
      answers.push({ ...base, source: "you" });
      continue;
    }
    answers.push(base);
    forModel.push(field);
  }
  return { answers, forModel };
}

/**
 * Applies the model's answers, keeping only what fits the field: a select's
 * value must be one of its options (matched by value or label), a boolean
 * must be a boolean. Anything else is left for the applicant.
 */
export function applyModelAnswers(answers: Answer[], modelOut: Record<string, unknown>): Answer[] {
  return answers.map((a) => {
    if (a.source !== "none" || !(a.key in modelOut)) return a;
    const raw = modelOut[a.key];
    if (raw === null || raw === undefined || raw === "") return a.required ? { ...a, source: "you" } : a;
    if (a.kind === "boolean") {
      const b = typeof raw === "boolean" ? raw : /^yes|true$/i.test(String(raw)) ? true : /^no|false$/i.test(String(raw)) ? false : null;
      return b === null ? { ...a, source: "you" } : { ...a, value: b, display: b ? "Yes" : "No", source: "ai" };
    }
    if (a.kind === "select" || a.kind === "multiselect") {
      const wanted = (Array.isArray(raw) ? raw : [raw]).map((r) => String(r).trim().toLowerCase());
      const chosen = (a.options ?? []).filter(
        (o) => wanted.includes(o.value.toLowerCase()) || wanted.includes(o.label.trim().toLowerCase())
      );
      if (chosen.length === 0) return { ...a, source: "you" };
      const picked = a.kind === "select" ? chosen.slice(0, 1) : chosen;
      return {
        ...a,
        value: a.kind === "select" ? picked[0].value : picked.map((o) => o.value),
        display: picked.map((o) => o.label).join(", "),
        source: "ai",
      };
    }
    if (a.kind === "file") {
      // A required cover letter: the drafted text goes in, attached as a file.
      return { ...a, value: String(raw).slice(0, 8000), display: "Drafted cover letter", source: "ai" };
    }
    return { ...a, value: String(raw).slice(0, 8000), source: "ai" };
  });
}

/** Required fields still without an answer -- what the applicant must do by hand. */
export function unansweredRequired(answers: Answer[]): Answer[] {
  return answers.filter(
    (a) => a.required && (a.source === "you" || a.source === "none" || a.value === null || a.value === "")
  );
}

export const ANSWER_SYSTEM_PROMPT = `You fill in a job application for a software engineer, answering only the questions given.

TRUTH
- The PROFILE and RESUME are the only facts about the candidate. Never invent experience, years, employers, degrees, clearances, skills or numbers.
- A yes/no screening question ("Do you have 7+ years of X?") is answered from the resume; if the resume does not clearly support "yes", answer "no".
- If a question cannot be answered truthfully from the facts, return null for it -- the candidate will answer it by hand.

STYLE for free-text answers
- First person, specific, plain. Tie the candidate's real work to what this company does. 60-150 words unless the question asks otherwise. No filler, no flattery, no em dashes.
- A cover letter (when asked) is 180-250 words, three short paragraphs.
- Puzzle or skill questions: solve them properly and give the answer.

OUTPUT
Only a JSON object mapping each question's "key" to its answer:
- select: the exact option label (one), multiselect: an array of exact option labels,
- boolean: true or false,
- anything else: a string,
- null when it cannot be answered truthfully.`;

export function buildAnswerMessages(
  fields: FormField[],
  profile: ApplicantProfile,
  resumeMarkdown: string,
  posting: { company: string; title: string; location: string; text: string }
): { role: "system" | "user"; content: string }[] {
  const facts = [
    `Name: ${profile.firstName} ${profile.lastName}`,
    `Location: ${[profile.city, profile.state, profile.country].filter(Boolean).join(", ")}`,
    profile.workAuthorizedUS && `Authorized to work in the US: ${profile.workAuthorizedUS}`,
    profile.needsSponsorship && `Needs visa sponsorship: ${profile.needsSponsorship}`,
    profile.willingToRelocate && `Willing to relocate: ${profile.willingToRelocate}`,
    profile.earliestStart && `Earliest start: ${profile.earliestStart}`,
    profile.extraFacts && `Other facts:\n${profile.extraFacts}`,
  ]
    .filter(Boolean)
    .join("\n");
  const questions = fields.map((f) => ({
    key: f.key,
    question: f.label,
    type: f.fileRole === "cover_letter" ? "cover letter (text)" : f.kind,
    required: f.required,
    ...(f.options.length ? { options: f.options.map((o) => o.label) } : {}),
  }));
  const user = [
    `JOB: ${posting.title} at ${posting.company} (${posting.location})`,
    posting.text ? `\nLISTING\n${posting.text.slice(0, 8000)}` : "",
    `\nPROFILE\n${facts}`,
    `\nRESUME\n${resumeMarkdown.slice(0, 12000) || "(none available)"}`,
    `\nQUESTIONS\n${JSON.stringify(questions, null, 1)}`,
  ].join("\n");
  return [
    { role: "system", content: ANSWER_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** The JSON object out of a model reply, tolerating a fence or prose around it. */
export function parseAnswerJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
