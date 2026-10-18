/**
 * How a team is named in a provider's stream or channel title. Pure.
 *
 * Streamy used each team's last word ("Sharks" from "San Jose Sharks"). That
 * fails when both sides share it: Manchester United at Leeds United
 * (2026-10-18) made every "... United" stream look like the game, and
 * "Masters FC vs. Karonga United" (Malawi) was checked first while twelve
 * real feeds -- "LEEDS - MAN UNITED", "Leeds x Man. United" -- waited.
 *
 * A team is identified by every name that tells it apart from its opponent:
 * its full name, known short forms ("Man Utd"), its distinctive last word
 * ("Sharks"), and the rest of its name when the last word is generic
 * ("Leeds" from "Leeds United", "San Diego" from "San Diego FC") -- unless
 * that place has two clubs ("Manchester"), where only the full name or a
 * short form will do.
 */

/** Last words that say nothing about which team it is. */
const GENERIC = new Set(["fc", "sc", "cf", "afc", "united", "utd", "city", "athletic", "club", "real", "state", "a&m"]);

/** Places with more than one club: never enough on their own. */
const SHARED_PLACES = new Set(["manchester", "milan", "madrid", "sheffield", "bristol", "new york", "los angeles", "la", "glasgow"]);

/** Common short forms providers use, by full team name (lowercase). */
const ALIASES: Record<string, string[]> = {
  "manchester united": ["man united", "man utd", "man u"],
  "manchester city": ["man city"],
  "tottenham hotspur": ["tottenham", "spurs"],
  "wolverhampton wanderers": ["wolves", "wolverhampton"],
  "brighton & hove albion": ["brighton"],
  "brighton and hove albion": ["brighton"],
  "west ham united": ["west ham"],
  "newcastle united": ["newcastle"],
  "nottingham forest": ["nottm forest", "nott'm forest"],
  "paris saint-germain": ["psg", "paris sg"],
  "internazionale": ["inter milan", "inter"],
  "bayern munich": ["bayern"],
  "atletico madrid": ["atletico", "atlético madrid"],
  "inter miami cf": ["inter miami"],
};

/** Lowercase, dots and extra spaces gone: "Man. United" reads as "man united". */
export function normaliseTeamText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastWord(team: string): string | null {
  return normaliseTeamText(team).split(" ").pop() ?? null;
}

/** The name without trailing generic words: "leeds" from "Leeds United". */
function stem(team: string): string | null {
  const words = normaliseTeamText(team).split(" ");
  while (words.length > 1 && GENERIC.has(words[words.length - 1])) words.pop();
  const s = words.join(" ");
  return s !== normaliseTeamText(team) ? s : null;
}

/** Every name that identifies `team` and not `opponent`, normalised. */
export function teamIdentifiers(team: string | null | undefined, opponent?: string | null): string[] {
  if (!team?.trim()) return [];
  const full = normaliseTeamText(team);
  const out = new Set<string>([full, ...(ALIASES[full] ?? [])]);
  const other = opponent ? normaliseTeamText(opponent) : "";
  const otherLast = opponent ? lastWord(opponent) : null;

  const last = lastWord(team);
  if (last && last.length >= 4 && !GENERIC.has(last) && last !== otherLast) out.add(last);

  const s = stem(team);
  if (s && s.length >= 4 && !SHARED_PLACES.has(s) && s !== (opponent ? stem(opponent) : null)) out.add(s);

  // Nothing that also names the opponent.
  return [...out].filter((id) => id && !(other && new RegExp(`(^|[^a-z0-9])${escape(id)}($|[^a-z0-9])`).test(other)));
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

/** Whether a title names `team` (as told apart from `opponent`), as whole words. */
export function nameHasTeam(name: string, team: string | null | undefined, opponent?: string | null): boolean {
  const text = normaliseTeamText(name);
  return teamIdentifiers(team, opponent).some((id) => new RegExp(`(^|[^a-z0-9])${escape(id)}($|[^a-z0-9])`).test(text));
}

/** Whether a title names both sides of a fixture. */
export function nameHasBothTeams(name: string, away: string | null | undefined, home: string | null | undefined): boolean {
  if (!away || !home) return false;
  return nameHasTeam(name, away, home) && nameHasTeam(name, home, away);
}

/** Short search terms for one team: what a catalogue substring search needs. */
export function teamSearchTerms(team: string | null | undefined, opponent?: string | null): string[] {
  const ids = [...teamIdentifiers(team, opponent)].sort((a, b) => a.length - b.length);
  // A substring search for "sharks" already finds "san jose sharks".
  return ids.filter((id, i) => !ids.slice(0, i).some((shorter) => id.includes(shorter))).slice(0, 3);
}
