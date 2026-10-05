/**
 * Which holiday the browse pages are dressed for today, and which titles in
 * the library belong to it. Pure.
 *
 * The row under My List follows the calendar: Halloween through October,
 * Christmas from the day after Thanksgiving, and so on. Outside every window
 * there is no holiday and no row -- a "seasonal" row padded out with things
 * that are not seasonal would be a genre row with a costume on.
 *
 * Titles are matched on TMDB keywords rather than genre alone. Genre says a
 * film is a comedy; only the keyword says it is set at Christmas. A holiday
 * may also name genres that fit it whole (Horror in October), and those fill
 * in behind the keyword matches.
 */

export type Holiday = {
  /** Stable name for the holiday, used as a React key and in tests. */
  slug: string;
  /** The row heading. */
  title: string;
  /** Keywords that mean the title is about this holiday. */
  primary: string[];
  /** Keywords that merely suit the season. */
  secondary: string[];
  /** TMDB genre names that suit the season as a whole. */
  genres: string[];
};

const NEW_YEARS: Holiday = {
  slug: "new-years",
  title: "New Year's",
  primary: ["new year's eve", "new years eve", "new year"],
  secondary: [],
  genres: [],
};

const VALENTINES: Holiday = {
  slug: "valentines",
  title: "Valentine's Day",
  primary: ["valentine's day", "valentine"],
  secondary: ["romantic comedy", "romcom", "love story"],
  genres: ["Romance"],
};

const ST_PATRICKS: Holiday = {
  slug: "st-patricks",
  title: "St. Patrick's Day",
  primary: ["st. patrick's day", "saint patrick's day"],
  secondary: ["ireland", "irish", "leprechaun"],
  genres: [],
};

const EASTER: Holiday = {
  slug: "easter",
  title: "Easter",
  primary: ["easter"],
  secondary: ["jesus christ", "bible"],
  genres: [],
};

const FOURTH_OF_JULY: Holiday = {
  slug: "fourth-of-july",
  title: "Fourth of July",
  primary: ["independence day", "fourth of july", "4th of july"],
  secondary: ["american revolution", "patriotism"],
  genres: [],
};

const HALLOWEEN: Holiday = {
  slug: "halloween",
  title: "Halloween",
  primary: ["halloween", "trick or treating", "jack-o'-lantern"],
  secondary: ["haunted house", "witch", "ghost", "vampire", "werewolf", "zombie", "horror"],
  // TMDB has a Horror genre for films only; shows get here on keywords.
  genres: ["Horror"],
};

const THANKSGIVING: Holiday = {
  slug: "thanksgiving",
  title: "Thanksgiving",
  primary: ["thanksgiving"],
  secondary: [],
  genres: [],
};

const CHRISTMAS: Holiday = {
  slug: "christmas",
  title: "Christmas",
  primary: ["christmas", "santa claus", "xmas"],
  secondary: [],
  genres: [],
};

/** Day of the month of US Thanksgiving: the fourth Thursday of November. */
export function thanksgivingDay(year: number): number {
  const firstWeekday = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - firstWeekday + 7) % 7);
  return firstThursday + 21;
}

/** Easter Sunday (Gregorian), by the anonymous computus. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * The holiday in season on a calendar date, or null between them.
 * `month` is 1-12.
 */
export function holidayOn(year: number, month: number, day: number): Holiday | null {
  const md = month * 100 + day;

  if (md >= 1226 || md <= 101) return NEW_YEARS;
  if (md >= 201 && md <= 214) return VALENTINES;
  if (md >= 310 && md <= 317) return ST_PATRICKS;

  // The week that ends on Easter Sunday.
  const easter = easterSunday(year);
  const easterAt = Date.UTC(year, easter.month - 1, easter.day);
  const daysToEaster = Math.round((easterAt - Date.UTC(year, month - 1, day)) / 86_400_000);
  if (daysToEaster >= 0 && daysToEaster <= 7) return EASTER;

  if (md >= 627 && md <= 704) return FOURTH_OF_JULY;
  if (month === 10) return HALLOWEEN;
  // November up to and including the day is Thanksgiving's; the morning
  // after, the tree goes up.
  if (month === 11) return day <= thanksgivingDay(year) ? THANKSGIVING : CHRISTMAS;
  if (month === 12 && day <= 25) return CHRISTMAS;

  return null;
}

/**
 * Today's holiday for the people watching. The server runs on UTC, where
 * October ends four or five hours before it does on the east coast, so the
 * date is read in the household's zone rather than the machine's.
 */
export function holidayNow(now: Date = new Date(), timeZone = "America/New_York"): Holiday | null {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return holidayOn(num("year"), num("month"), num("day"));
}

/** Lowercase words only, so "Jack-o'-Lantern" and "jack o lantern" are one keyword. */
function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Whole-word match: "witch" is in "witch hunt" and not in "switchblade". */
function hasAny(keywords: string[], terms: string[]): boolean {
  if (terms.length === 0) return false;
  const wanted = terms.map(words);
  return keywords.some((k) => {
    const have = words(k);
    return wanted.some((w) => have.includes(w));
  });
}

type Tagged = { keywords: string[]; genres: string[]; popularity?: number };

/** 2 for a title about the holiday, 1 for one that suits the season, 0 otherwise. */
export function holidayScore(holiday: Holiday, title: Tagged): 0 | 1 | 2 {
  if (hasAny(title.keywords, holiday.primary)) return 2;
  if (hasAny(title.keywords, holiday.secondary)) return 1;
  if (title.genres.some((g) => holiday.genres.includes(g))) return 1;
  return 0;
}

/** The titles that belong in the holiday row: about-the-holiday first, then by popularity. */
export function pickHolidayTitles<T extends Tagged>(holiday: Holiday, titles: T[]): T[] {
  return titles
    .map((title) => ({ title, score: holidayScore(holiday, title) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || (b.title.popularity ?? 0) - (a.title.popularity ?? 0))
    .map((t) => t.title);
}
