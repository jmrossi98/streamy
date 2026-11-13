/**
 * What one subscription row says, said once (2026-11-13). The row used to give
 * a trex line's expiry four times -- "expires Nov 15, 2026 (2d)", "Expires in
 * 2 days." twice, "in 2d / Nov 15, 2026" -- and its size twice ("2 lines, 2
 * connections", then "2 lines · 2 connections"). Pure.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** When it is due, in words: "in 2 days", "today", "3 days overdue"; null with no date. */
export function dueLabel(daysLeft: number | null, problem?: string | null): string | null {
  if (problem) return "unknown";
  if (daysLeft === null) return null;
  if (daysLeft < 0) return `${plural(Math.abs(daysLeft), "day")} overdue`;
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${plural(daysLeft, "day")}`;
}

/**
 * The alert worth its own line under a row, or null. "Expires in 2 days." is
 * what the row's date already says (in amber), so it is left out; an expired
 * login or one that couldn't be checked is not said anywhere else.
 */
export function attentionText(alert: { tone: string; text: string } | null | undefined): string | null {
  if (!alert) return null;
  if (alert.tone !== "danger" && /^Expires in \d+ days?\.?$/.test(alert.text.trim())) return null;
  return alert.text;
}

/** The facts under a row's name, once: "$10.00/mo · 2 lines · 2 connections". */
export function rowFacts(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(" · ");
}

/** An IPTV line's name as the row lists it: the account's own login reads "Main login". */
export function lineLabel(line: { name: string; isDefault: boolean }): string {
  return line.isDefault ? "Main login" : line.name;
}

/** An IPTV line's expiry as the row lists it: "Nov 15, 2026 · in 2 days", "lapsed Nov 15, 2026", "no expiry date". */
export function lineExpiryText(expiresUtc: string | null, daysLeft: number | null, format: (iso: string) => string): string {
  if (!expiresUtc) return "no expiry date";
  if (daysLeft !== null && daysLeft < 0) return `lapsed ${format(expiresUtc)}`;
  const due = dueLabel(daysLeft);
  return due ? `${format(expiresUtc)} · ${due}` : format(expiresUtc);
}
