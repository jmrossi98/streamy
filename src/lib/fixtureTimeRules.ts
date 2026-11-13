/**
 * When an upcoming game starts, on the viewer's own clock: "7:00 PM" for a
 * game today, "Fri 12:30 AM" for one on another day. Shorter than ESPN's own
 * "11/13 - 7:00 PM EST", which left a phone row no room for the game's name
 * (2026-11-13). Null when there is no start time to show.
 */
export function upcomingStartLabel(startUtc: string | null | undefined, now: Date = new Date(), locale?: string): string | null {
  if (!startUtc) return null;
  const start = new Date(startUtc);
  if (Number.isNaN(start.getTime())) return null;
  const time = start.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (start.toDateString() === now.toDateString()) return time;
  return `${start.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}
