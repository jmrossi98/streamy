/**
 * Application forms, normalised. Greenhouse and Ashby both publish the exact
 * questions a job's application asks -- Greenhouse through its job board API
 * (`?questions=true`), Ashby through the same public GraphQL its own apply page
 * uses -- so a packet can be prepared before the form is ever opened. Pure; the
 * fetching lives in applyForms.ts.
 *
 * Neither lets an application be *submitted* from a server: both require a
 * CAPTCHA token from a real browser. So the form is filled in the browser (the
 * userscript) and the last click stays with a person.
 */

export type ApplyProvider = "greenhouse" | "ashby";

export type FieldKind =
  | "text"
  | "email"
  | "phone"
  | "textarea"
  | "file"
  | "select"
  | "multiselect"
  | "boolean"
  | "date"
  | "location"
  | "number";

export type FormOption = { label: string; value: string };

export type FormField = {
  /** The provider's own field id -- the DOM input's id/name on the form. */
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: FormOption[];
  /** "resume", "cover_letter" or null -- files are attached, not typed. */
  fileRole?: "resume" | "cover_letter" | null;
  /** EEO / demographic section, answered separately (decline by default). */
  demographic?: boolean;
};

export type ApplyTarget = { provider: ApplyProvider; slug: string; jobId: string };

/** "greenhouse:stripe:7557403" -> the target; null for any other provider. */
export function applyTargetFromPostingId(postingId: string): ApplyTarget | null {
  const m = /^(greenhouse|ashby):([^:]+):(.+)$/.exec(postingId);
  if (!m) return null;
  return { provider: m[1] as ApplyProvider, slug: m[2], jobId: m[3] };
}

/**
 * Where to apply. Greenhouse's embed form rather than the listing's own URL:
 * listings often live on the company's site (stripe.com/jobs?gh_jid=...), which
 * frames the form in an iframe anyway, and the embed is that iframe on its own.
 */
export function applyUrl(t: ApplyTarget): string {
  return t.provider === "greenhouse"
    ? `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(t.slug)}&token=${encodeURIComponent(t.jobId)}`
    : `https://jobs.ashbyhq.com/${encodeURIComponent(t.slug)}/${encodeURIComponent(t.jobId)}/application`;
}

/**
 * The target a page belongs to, from its URL -- how the userscript finds its
 * packet. Covers Greenhouse's hosted board, its embed, and Ashby's apply page.
 */
export function applyTargetFromUrl(url: string): ApplyTarget | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
    const forSlug = u.searchParams.get("for");
    const token = u.searchParams.get("token");
    if (forSlug && token) return { provider: "greenhouse", slug: forSlug, jobId: token };
    const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
    if (m) return { provider: "greenhouse", slug: m[1], jobId: m[2] };
    return null;
  }
  if (u.hostname === "jobs.ashbyhq.com") {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/i.exec(u.pathname);
    if (m) return { provider: "ashby", slug: decodeURIComponent(m[1]), jobId: m[2].toLowerCase() };
  }
  return null;
}

// ---------------------------------------------------------------- Greenhouse

type GhField = { name?: string; type?: string; values?: { label?: string; value?: string | number }[] };
type GhQuestion = { label?: string; required?: boolean; fields?: GhField[] };
type GhDemographic = {
  questions?: {
    id?: number | string;
    label?: string;
    required?: boolean;
    type?: string;
    answer_options?: { id?: number | string; label?: string }[];
  }[];
};

const GH_KIND: Record<string, FieldKind> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "select",
  multi_value_multi_select: "multiselect",
};

export function greenhouseFields(job: {
  questions?: GhQuestion[];
  location_questions?: GhQuestion[];
  demographic_questions?: GhDemographic | null;
}): FormField[] {
  const out: FormField[] = [];
  for (const q of [...(job.questions ?? []), ...(job.location_questions ?? [])]) {
    const label = (q.label ?? "").trim();
    const fields = (q.fields ?? []).filter((f) => f.name && f.type && f.type !== "input_hidden");
    // "Resume/CV" offers a file *or* pasted text; the file is the one to fill.
    const field = fields.find((f) => f.type === "input_file") ?? fields[0];
    if (!field?.name) continue;
    const kind = GH_KIND[field.type ?? ""] ?? "text";
    const name = field.name;
    out.push({
      key: name,
      label,
      kind: name === "email" ? "email" : name === "phone" ? "phone" : kind,
      required: Boolean(q.required),
      options: (field.values ?? []).map((v) => ({ label: String(v.label ?? ""), value: String(v.value ?? "") })),
      fileRole: kind === "file" ? (/cover/i.test(name + label) ? "cover_letter" : "resume") : null,
    });
  }
  for (const q of job.demographic_questions?.questions ?? []) {
    if (q.id == null) continue;
    out.push({
      key: String(q.id),
      label: (q.label ?? "").trim(),
      kind: q.type === "multi_value_multi_select" ? "multiselect" : "select",
      required: Boolean(q.required),
      options: (q.answer_options ?? []).map((o) => ({ label: String(o.label ?? ""), value: String(o.id ?? "") })),
      demographic: true,
    });
  }
  return out;
}

// --------------------------------------------------------------------- Ashby

type AshbyFieldEntry = {
  isRequired?: boolean;
  field?: {
    path?: string;
    title?: string;
    type?: string;
    selectableValues?: { label?: string; value?: string }[] | null;
  };
};

const ASHBY_KIND: Record<string, FieldKind> = {
  String: "text",
  Email: "email",
  Phone: "phone",
  LongText: "textarea",
  File: "file",
  ValueSelect: "select",
  MultiValueSelect: "multiselect",
  Boolean: "boolean",
  Date: "date",
  Location: "location",
  Number: "number",
};

export function ashbyFields(posting: {
  applicationForm?: { sections?: { fieldEntries?: AshbyFieldEntry[] }[] } | null;
  surveyForms?: { sections?: { fieldEntries?: AshbyFieldEntry[] }[] }[] | null;
}): FormField[] {
  const out: FormField[] = [];
  const add = (entries: AshbyFieldEntry[], demographic: boolean) => {
    for (const e of entries) {
      const f = e.field;
      if (!f?.path || !f.type) continue;
      const kind = ASHBY_KIND[f.type] ?? "text";
      out.push({
        key: f.path,
        label: (f.title ?? "").trim(),
        kind,
        required: Boolean(e.isRequired),
        options: (f.selectableValues ?? []).map((v) => ({ label: String(v.label ?? ""), value: String(v.value ?? "") })),
        fileRole: kind === "file" ? (/cover/i.test(f.title ?? "") ? "cover_letter" : "resume") : null,
        demographic,
      });
    }
  };
  for (const s of posting.applicationForm?.sections ?? []) add(s.fieldEntries ?? [], false);
  for (const form of posting.surveyForms ?? []) for (const s of form.sections ?? []) add(s.fieldEntries ?? [], true);
  return out;
}
