/**
 * Cleanup for text we render but don't write.
 *
 * Channel names, EPG programme titles and fixture names all arrive from
 * somewhere else -- the IPTV provider, Jellyfin's guide, ESPN -- and they are
 * full of em dashes ("NHL Hockey — Sharks at Bruins"). Sweeping our own copy
 * for dashes doesn't touch any of that, because none of it is in the source.
 *
 * So it gets normalized where it enters instead of at each of the dozen
 * places it's rendered.
 */

/** Em, en, horizontal bar, figure dash, and the two minus-like lookalikes. */
const DASHES = /[‒–—―−﹘﹣－]/g;

/**
 * Replaces typographic dashes with plain hyphens, keeping the spacing that
 * was around them.
 *
 * Spacing carries the meaning: " — " separates two things and reads as
 * " - ", while "2024—25" is a range and reads as "2024-25". Collapsing both
 * to the same thing gets one of them wrong.
 */
export function normalizeDashes(input: string): string {
  return input
    .replace(/\s*[‒–—―−﹘﹣－]\s*/g, (match) =>
      /\s/.test(match) ? " - " : "-"
    )
    .replace(DASHES, "-");
}

/**
 * The full pass for a string from an external source: dashes normalized,
 * smart quotes flattened, whitespace collapsed, trimmed.
 *
 * Returns "" for nullish input so callers can use it without a guard; the
 * empty string is falsy, which is what a missing title should behave like.
 */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return normalizeDashes(input)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}
