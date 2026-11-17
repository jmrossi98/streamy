/**
 * Game downloads in SABnzbd, and where each game stands. Pure.
 *
 * A game Streamy sends to SABnzbd is named "[game <system> igdb:<id>]
 * <release>". The name is the whole record: mediabox-infra's game-import.py
 * reads the console from it to file the finished download into
 * /data/roms-inbox/<system>/ (whence rom-inbox.py puts it in the library),
 * and the game's page reads the IGDB id from it to say how far it has got.
 * No table to keep in step with SABnzbd's own state.
 */
import { titleSimilarity } from "./romNames";

// SABnzbd swaps the ":" for "_" in a job's name (it is a folder name too),
// so "[game switch igdb:26758]" comes back as "[game switch igdb_26758]".
const JOB = /^\[game ([a-z0-9]+) igdb[:_](\d+)\] (.+)$/;

export function gameJobName(system: string, igdbId: number, release: string): string {
  return `[game ${system} igdb:${igdbId}] ${release}`;
}

export function parseGameJobName(name: string): { system: string; igdbId: number; release: string } | null {
  const m = JOB.exec(name.trim());
  return m ? { system: m[1], igdbId: Number(m[2]), release: m[3] } : null;
}

export type GameJob = { name: string; state: "queued" | "downloading" | "processing" | "completed" | "failed"; progress: number | null; failMessage: string | null };
export type LibraryGame = { gameKey: string; displayTitle: string; system: string | null; platformSlug: string; status: string; progress: number | null; error?: string | null };

export type SystemStatus =
  | { state: "owned"; gameKey: string }
  | { state: "downloading"; progress: number | null; via: "usenet" | "gamarr" }
  | { state: "importing" }
  | { state: "queued"; via: "usenet" | "gamarr" }
  | { state: "failed"; message: string | null }
  | { state: "available" };

/** The same game, by name: close enough, and no different number in the series. */
export const SAME_GAME = 0.85;

/**
 * Where one game stands on one console: in the library, downloading, being
 * filed, waiting, failed, or none of those. Its own SABnzbd jobs (by IGDB id)
 * come first, then gamarr's queue (by name and platform), then the library
 * (by name, in the console's folder).
 */
export function systemStatus(
  igdbId: number,
  gameName: string,
  system: { slug: string; folders: string[]; gamarrSlug: string },
  jobs: GameJob[],
  library: LibraryGame[]
): SystemStatus {
  const owned = library.find(
    (g) => g.status === "library" && !!g.system && system.folders.includes(g.system) && titleSimilarity(g.displayTitle, gameName) >= SAME_GAME
  );
  if (owned) return { state: "owned", gameKey: owned.gameKey };

  const mine = jobs
    .map((j) => ({ job: j, parsed: parseGameJobName(j.name) }))
    .filter((x) => x.parsed?.igdbId === igdbId && x.parsed.system === system.slug)
    .map((x) => x.job);
  const live = mine.find((j) => j.state === "downloading") ?? mine.find((j) => j.state === "queued");
  if (live) return live.state === "downloading" ? { state: "downloading", progress: live.progress, via: "usenet" } : { state: "queued", via: "usenet" };
  if (mine.some((j) => j.state === "processing" || j.state === "completed")) return { state: "importing" };

  const theirs = library.find(
    (g) => g.status !== "library" && g.platformSlug === system.gamarrSlug && titleSimilarity(g.displayTitle, gameName) >= SAME_GAME
  );
  if (theirs?.status === "downloading") return { state: "downloading", progress: theirs.progress, via: "gamarr" };
  if (theirs?.status === "queued") return { state: "queued", via: "gamarr" };
  if (theirs?.status === "failed") return { state: "failed", message: theirs.error ?? null };

  const failed = mine.find((j) => j.state === "failed");
  if (failed) return { state: "failed", message: failed.failMessage };
  return { state: "available" };
}
