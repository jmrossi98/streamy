/**
 * Live TV in the header search (2026-10-16): typing "sharks" during a Sharks
 * game should land on that game, and "nbc sports" on the channel, without
 * going through the Live TV page first. Pure, so it tests without a tuner or
 * a schedule.
 */

export type LiveSearchGame = { id: string; name: string; league: string; detail: string; state: "pre" | "in" | "post" };
export type LiveSearchChannel = { id: string; name: string; number: string | null; nowName: string | null };

const MAX_GAMES = 5;
const MAX_CHANNELS = 6;

function terms(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

/** Every term appears in the text, each at the start of a word ("shar" matches Sharks, "arks" doesn't). */
function matchesAll(text: string, ts: string[]): boolean {
  const words = text.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
  return ts.every((t) => words.some((w) => w.startsWith(t)));
}

/**
 * Today's games that match, in progress first, then not yet started.
 * Finished games are left out: search is for something to watch.
 */
export function matchGames<G extends LiveSearchGame & { awayTeam?: string | null; homeTeam?: string | null }>(q: string, games: G[]): G[] {
  const ts = terms(q);
  if (ts.length === 0) return [];
  return games
    .filter((g) => g.state !== "post")
    .filter((g) => matchesAll([g.name, g.league, g.awayTeam ?? "", g.homeTeam ?? ""].join(" "), ts))
    .sort((a, b) => Number(b.state === "in") - Number(a.state === "in"))
    .slice(0, MAX_GAMES);
}

/** Channels whose name, number or current programme matches; name matches first. */
export function matchChannels<C extends LiveSearchChannel>(q: string, channels: C[]): C[] {
  const ts = terms(q);
  if (ts.length === 0) return [];
  const byName = channels.filter((c) => matchesAll(c.name, ts) || (c.number ?? "") === q.trim());
  const byProgramme = channels.filter((c) => !byName.includes(c) && c.nowName && matchesAll(c.nowName, ts));
  return [...byName, ...byProgramme].slice(0, MAX_CHANNELS);
}
