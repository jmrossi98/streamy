/**
 * Sorting a person's credits by what they did on the title. Pure.
 *
 * A person page used to be two rows, Movies and TV Shows, with acting,
 * directing and producing credits mixed together: Clint Eastwood's page could
 * not say which films he directed. TMDB records the relationship on every
 * credit -- a cast entry, or a crew entry with a job and a department -- and
 * this turns that into the section the credit belongs under.
 */

export type CreditSection = { key: string; label: string };

/** The fields of a TMDB crew credit that say what the person did. */
export type CrewRole = { job?: string | null; department?: string | null };

export const ACTED: CreditSection = { key: "acted", label: "Acted in" };
const DIRECTED: CreditSection = { key: "directed", label: "Directed" };
const WROTE: CreditSection = { key: "wrote", label: "Wrote" };
const PRODUCED: CreditSection = { key: "produced", label: "Produced" };
const CREATED: CreditSection = { key: "created", label: "Created" };

/** The order sections appear in, after the one the person is known for. */
const ORDER = [DIRECTED.key, ACTED.key, WROTE.key, CREATED.key, PRODUCED.key];

/** TMDB's `known_for_department` -> the section that should lead. */
const KNOWN_FOR: Record<string, string> = {
  Acting: ACTED.key,
  Directing: DIRECTED.key,
  Writing: WROTE.key,
  Production: PRODUCED.key,
  Creator: CREATED.key,
};

/** Departments whose name does not read as a heading by itself. */
const DEPARTMENT_LABEL: Record<string, string> = {
  Camera: "Cinematography",
  Sound: "Music & sound",
  Art: "Art direction",
  "Costume & Make-Up": "Costume & make-up",
  "Visual Effects": "Visual effects",
  Crew: "Other crew",
  Directing: "Directing team",
  Production: "Production team",
};

/**
 * The section a crew credit goes under.
 *
 * By job first: "Directing" as a department also holds assistant directors
 * and script supervisors, and "Production" holds casting and location staff.
 * Putting those under Directed or Produced would credit a second assistant
 * director with directing the film. They get their department's own section.
 */
export function crewSection(role: CrewRole): CreditSection {
  const job = (role.job ?? "").trim();
  const department = (role.department ?? "").trim();
  if (job === "Director" || job === "Co-Director" || job === "Series Director") return DIRECTED;
  if (job === "Creator" || department === "Creator") return CREATED;
  if (/\bproducer\b/i.test(job)) return PRODUCED;
  if (department === "Writing") return WROTE;
  if (!department) return { key: "crew:other", label: DEPARTMENT_LABEL.Crew };
  return { key: `crew:${department.toLowerCase()}`, label: DEPARTMENT_LABEL[department] ?? department };
}

/**
 * Sections in reading order: what the person is known for first, then the
 * headline roles, then the remaining departments by name.
 */
export function orderSections<T extends CreditSection>(sections: T[], knownForDepartment: string | null): T[] {
  const lead = knownForDepartment ? KNOWN_FOR[knownForDepartment] : undefined;
  const rank = (s: T) => {
    if (s.key === lead) return -1;
    const i = ORDER.indexOf(s.key);
    return i === -1 ? ORDER.length : i;
  };
  return [...sections].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
