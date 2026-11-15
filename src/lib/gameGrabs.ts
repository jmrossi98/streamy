/**
 * Getting a game from the catalog onto a console's shelf. Server-only.
 *
 * Usenet first, through the same Prowlarr search the healer uses: a scene
 * release names its console ("NSW", "PS2DVD"), downloads at line speed and
 * has no swarm to wait on. The best one (gameReleaseRules.ts) is fetched here
 * and handed to SABnzbd, named so mediabox's game-import.py knows which ROM
 * folder it belongs in (gameJobRules.ts). With no usenet release, the game
 * goes on gamarr's wishlist instead, as the Get button always did: gamarr
 * searches its torrent and direct-download sources itself, scans what it
 * fetches, and files it.
 */
import { systemBySlug, systemFolders, type GameSystem } from "./gameSystems";
import { rankGameReleases, type RankedRelease } from "./gameReleaseRules";
import { gameJobName, systemStatus, type SystemStatus } from "./gameJobRules";
import { isProwlarrConfigured, prowlarrTextSearch } from "./prowlarr";
import type { TextResult } from "./textSearchRules";
import { addSabNzbFile, listSabJobs, type SabJob } from "./sabnzbd";
import { queueGame } from "./gamarr";
import { getGamesList, platformToSlug } from "./games";

/** SABnzbd's category for game downloads: one Sonarr and Radarr ignore. */
const GAME_CATEGORY = "software";
/** Prowlarr's console category, every console under it. */
const PROWLARR_CONSOLE = 1000;

/** The usenet releases of this game for this console, best first. */
export async function findGameReleases(gameName: string, system: GameSystem): Promise<RankedRelease<TextResult & { protocol: string }>[]> {
  if (!isProwlarrConfigured()) return [];
  const results = await prowlarrTextSearch(gameName, PROWLARR_CONSOLE);
  const usenet = results.filter((r): r is TextResult & { protocol: string } => r.protocol === "usenet");
  return rankGameReleases(usenet, gameName, system);
}

export type GameRequestResult =
  | { ok: true; via: "usenet"; release: string }
  | { ok: true; via: "gamarr" }
  | { ok: false; error: string };

/** Starts a game downloading for one console: usenet when there is a release, gamarr's queue when not. */
export async function requestGame(igdbId: number, gameName: string, systemSlug: string): Promise<GameRequestResult> {
  const system = systemBySlug(systemSlug);
  if (!system) return { ok: false, error: "Streamy can't fetch games for that console." };

  let releases: Awaited<ReturnType<typeof findGameReleases>> = [];
  try {
    releases = await findGameReleases(gameName, system);
  } catch (err) {
    console.error(`[games] usenet search failed for "${gameName}" (${system.slug}):`, err);
  }
  for (const { release } of releases.slice(0, 3)) {
    if (!release.downloadUrl) continue;
    try {
      const res = await fetch(release.downloadUrl, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
      const nzb = res.ok ? await res.text() : "";
      if (!/<nzb[\s>]/i.test(nzb)) {
        console.warn(`[games] "${release.title}" (${release.indexer}) did not return an NZB (HTTP ${res.status})`);
        continue;
      }
      const nzoId = await addSabNzbFile(nzb, gameJobName(system.slug, igdbId, release.title), GAME_CATEGORY);
      if (nzoId) {
        console.log(`[games] "${gameName}" (${system.slug}): sent "${release.title}" (${release.indexer}) to SABnzbd`);
        return { ok: true, via: "usenet", release: release.title };
      }
    } catch (err) {
      console.error(`[games] could not fetch "${release.title}":`, err);
    }
  }

  const queued = await queueGame({ title: gameName, platform: system.gamarr.name, platformSlug: system.gamarr.id });
  if (!queued.ok) return { ok: false, error: `No usenet release, and gamarr would not take it: ${queued.error}` };
  console.log(`[games] "${gameName}" (${system.slug}): no usenet release; queued in gamarr`);
  return { ok: true, via: "gamarr" };
}

/** Where a game stands on each console it can be fetched for. */
export async function gameStatuses(igdbId: number, gameName: string, systemSlugs: string[]): Promise<Record<string, SystemStatus>> {
  const [jobs, library] = await Promise.all([
    listSabJobs().catch((): SabJob[] => []),
    getGamesList().catch(() => []),
  ]);
  const out: Record<string, SystemStatus> = {};
  for (const slug of systemSlugs) {
    const system = systemBySlug(slug);
    if (!system) continue;
    out[slug] = systemStatus(
      igdbId,
      gameName,
      { slug, folders: systemFolders(system), gamarrSlug: platformToSlug(system.gamarr.name) },
      jobs,
      library
    );
  }
  return out;
}

