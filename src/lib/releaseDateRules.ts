/**
 * How a release date is shown. Pure.
 *
 * TMDB gives a calendar date with no time or zone ("1999-03-31"). Handing
 * that to `new Date` reads it as midnight UTC, which a viewer west of
 * Greenwich then sees as the evening before. The parts are read straight out
 * of the text instead, so the date shown is the date given, everywhere.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1999-03-31" -> "Mar 31, 1999". Null for anything that is not a real date. */
export function formatReleaseDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The full date when there is one, else the year, else nothing. */
export function releaseLabel(title: { releaseDate?: string; year: string }): string {
  return formatReleaseDate(title.releaseDate) ?? title.year;
}
