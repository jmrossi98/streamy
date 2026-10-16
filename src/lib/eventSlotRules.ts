/**
 * Event-slot streams: a provider's per-game feeds, named for one game and
 * dead the rest of the day. Pure.
 *
 * The catalogue carries hundreds of these -- "NHL | 08 - 8pm Sharks at
 * Predators", "NFL | 03 - 1pm Patriots at Bills" -- one per slot per league.
 * Each one carries video only from shortly before its game to shortly after;
 * outside that it is a slate or nothing, and the stream probe says "dead".
 * A viewer who found one in the lineup at noon, or in the finder the next
 * morning, got a channel that would never play. On 2026-10-16 two copies of
 * the Patriots at Bills slot sat in the lineup three days after the game.
 *
 * The time in the name is the provider's, in US Eastern (every slot seen so
 * far has been), and the date is today's: a slot is reused day after day.
 */

export type EventSlotState = "upcoming" | "live" | "over";

/** How early a slot goes live before its game, and how long a game is given. */
export const SLOT_OPENS_BEFORE_MS = 30 * 60_000;
export const SLOT_LASTS_MS = 4 * 60 * 60_000;

const SLOT = /^\s*(?:[A-Z0-9 .&+-]{2,20})\s*\|\s*\d{1,3}\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

/** The slot's start as UTC minutes-from-midnight-ET, or null when the name is not a slot. */
export function eventSlotStart(name: string): { hour: number; minute: number } | null {
  const m = SLOT.exec(name);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") hour += 12;
  return { hour, minute: m[2] ? Number(m[2]) : 0 };
}

/** The offset of US Eastern from UTC at `now`, in hours (-4 or -5). */
function easternOffsetHours(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((asUtc - Math.floor(now / 60_000) * 60_000) / 3_600_000);
}

/** When the slot named here starts today, Eastern, as a timestamp; null for a non-slot. */
export function eventSlotStartsAt(name: string, now: number = Date.now()): number | null {
  const start = eventSlotStart(name);
  if (!start) return null;
  const offset = easternOffsetHours(now);
  // Today's date in Eastern, then the slot's clock time on it.
  const easternNow = new Date(now + offset * 3_600_000);
  return Date.UTC(easternNow.getUTCFullYear(), easternNow.getUTCMonth(), easternNow.getUTCDate(), start.hour - offset, start.minute);
}

/**
 * Whether the slot named here is before, in, or past its window right now.
 * Null for anything that is not an event slot, which is left alone.
 */
export function eventSlotState(name: string, now: number = Date.now()): EventSlotState | null {
  const startsAt = eventSlotStartsAt(name, now);
  if (startsAt == null) return null;
  const inWindow = (start: number) => now >= start - SLOT_OPENS_BEFORE_MS && now <= start + SLOT_LASTS_MS;
  // A late slot runs past Eastern midnight: a 10:30pm tip is still on at
  // 1am, when "today's" slot is the next evening's.
  if (inWindow(startsAt) || inWindow(startsAt - 86_400_000)) return "live";
  if (now > startsAt + SLOT_LASTS_MS) return "over";
  return "upcoming";
}

/** "Starts 8pm" / "Game over" for a badge; null when there is nothing to say. */
export function eventSlotLabel(name: string, now: number = Date.now()): string | null {
  const state = eventSlotState(name, now);
  if (state === "over") return "Game over - slot is idle";
  if (state === "upcoming") {
    const s = eventSlotStart(name)!;
    const h12 = s.hour % 12 || 12;
    return `Starts ${h12}${s.minute ? `:${String(s.minute).padStart(2, "0")}` : ""}${s.hour < 12 ? "am" : "pm"} ET`;
  }
  return null;
}
