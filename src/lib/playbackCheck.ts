/**
 * End-to-end check of the path a viewer actually takes: request a title,
 * wait for it to land, then exercise the real HLS/seek chain a player uses,
 * before deleting it again.
 *
 * Mirrors mediabox-infra/scripts/e2e-playback.mjs's playback stages (that
 * script remains the fast, on-demand, no-download version for triage
 * against whatever's already in the library) but adds the piece that script
 * deliberately didn't do: a real download, so a break anywhere in Radarr ->
 * qBittorrent/SABnzbd -> import -> Jellyfin scan -> transcode is caught
 * before a viewer ever finds it. Playback broke four separate times in one
 * week, each looking identical from outside ("black screen", "couldn't
 * start playback") with a different cause every time -- none of it visible
 * to a unit test, since every failure was a disagreement between Streamy and
 * Jellyfin about the *shape of a request*, only provable against the real
 * chain.
 *
 * Test title: "Night of the Living Dead" (1968), TMDB 10331 -- public domain
 * (its copyright notice was accidentally omitted from release prints), so
 * there is no rights question in downloading and deleting it on a schedule.
 * Verified via a live Radarr lookup before use, not assumed. Small (~90 min,
 * commonly small file sizes) and reliably available across indexers, which
 * keeps a run fast and this from meaningfully taxing a tracker.
 *
 * Deleted from Radarr (file included) at the end of every run, pass or fail
 * -- storage-neutral and repeatable. The per-stage detail stored in the
 * database is enough to diagnose a failure; keeping the file around isn't
 * necessary for that and would just accumulate.
 */

import { prisma } from "./db";
import { requestMovie, deleteRadarrMovie, getRadarrCompletedMovies, isRadarrConfigured } from "./radarr";
import { findJellyfinMovieItemId, jellyfinHlsMasterUrl, isJellyfinConfigured } from "./jellyfin";
import { notify, isNotifyConfigured } from "./notify";

export const TEST_MOVIE_TMDB_ID = "10331"; // Night of the Living Dead (1968), public domain
export const TEST_MOVIE_LABEL = "Night of the Living Dead (1968)";

const MAX_WAIT_FOR_IMPORT_MS = 10 * 60 * 1000; // grab -> download -> import, real and unpredictable
const IMPORT_POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_FOR_JELLYFIN_MS = 90 * 1000; // Jellyfin's own scan after import lands
const JELLYFIN_POLL_INTERVAL_MS = 5_000;
const FAR_SEGMENT_INDEX = 200; // ~10 minutes in -- proves seeking, not just start
const SEGMENT_MIN_BYTES = 10_000; // a 200 with an empty body is still a failure

type Stage = { name: string; ok: boolean; detail: string };

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForImport(radarrId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const completed = await getRadarrCompletedMovies();
    if (completed.some((m) => m.id === radarrId)) return true;
    await sleep(IMPORT_POLL_INTERVAL_MS);
  }
  return false;
}

async function waitForJellyfinItem(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await findJellyfinMovieItemId(TEST_MOVIE_TMDB_ID);
    if (id) return id;
    await sleep(JELLYFIN_POLL_INTERVAL_MS);
  }
  return null;
}

/** Fetches one HLS resource by resolving a relative reference against the
 *  master playlist's own origin/api_key, the same way a real player's HLS
 *  client does after Streamy's own proxy rewrites the reference -- see
 *  streamProxy.ts. This talks to Jellyfin directly (no auth needed here,
 *  this runs server-side), unlike the proxy a browser actually goes through. */
async function fetchJellyfinResource(masterUrl: string, itemId: string, relativeRef: string): Promise<Response> {
  const base = new URL(masterUrl);
  const apiKey = base.searchParams.get("api_key") ?? "";
  const [path, query = ""] = relativeRef.split("?");
  const url = new URL(`${base.origin}/Videos/${itemId}/${path}`);
  new URLSearchParams(query).forEach((v, k) => url.searchParams.set(k, v));
  if (!url.searchParams.has("api_key")) url.searchParams.set("api_key", apiKey);
  return fetch(url.toString(), { cache: "no-store" });
}

async function runStages(): Promise<{ stages: Stage[]; radarrId: number | null }> {
  const stages: Stage[] = [];
  let radarrId: number | null = null;

  if (!isRadarrConfigured()) {
    stages.push({ name: "prerequisites", ok: false, detail: "Radarr is not configured" });
    return { stages, radarrId };
  }
  if (!isJellyfinConfigured()) {
    stages.push({ name: "prerequisites", ok: false, detail: "Jellyfin is not configured" });
    return { stages, radarrId };
  }

  const req = await requestMovie(TEST_MOVIE_TMDB_ID);
  if (!req.ok) {
    stages.push({ name: "grab", ok: false, detail: req.error });
    return { stages, radarrId };
  }
  radarrId = req.radarrId;
  stages.push({ name: "grab", ok: true, detail: `requested via Radarr (id ${radarrId})` });

  const imported = await waitForImport(radarrId, MAX_WAIT_FOR_IMPORT_MS);
  stages.push({
    name: "download + import",
    ok: imported,
    detail: imported ? "Radarr reports the file imported" : `still not imported after ${MAX_WAIT_FOR_IMPORT_MS / 1000}s`,
  });
  if (!imported) return { stages, radarrId };

  const itemId = await waitForJellyfinItem(MAX_WAIT_FOR_JELLYFIN_MS);
  stages.push({
    name: "Jellyfin scan",
    ok: !!itemId,
    detail: itemId ? `found as Jellyfin item ${itemId}` : `not visible in Jellyfin after ${MAX_WAIT_FOR_JELLYFIN_MS / 1000}s`,
  });
  if (!itemId) return { stages, radarrId };

  let masterUrl: string;
  let variantRef: string | undefined;
  try {
    masterUrl = jellyfinHlsMasterUrl(itemId, crypto.randomUUID());
    const res = await fetch(masterUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!body.startsWith("#EXTM3U")) throw new Error("not an HLS playlist");
    variantRef = body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim();
    if (!variantRef) throw new Error("master playlist names no variant");
    stages.push({ name: "master playlist", ok: true, detail: "200, names a variant" });
  } catch (err) {
    stages.push({ name: "master playlist", ok: false, detail: String(err instanceof Error ? err.message : err) });
    return { stages, radarrId };
  }

  let segmentRefs: string[] = [];
  try {
    const res = await fetchJellyfinResource(masterUrl, itemId, variantRef);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    segmentRefs = body.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    if (!segmentRefs.length) throw new Error("variant playlist names no segments");
    stages.push({ name: "variant playlist", ok: true, detail: `${segmentRefs.length} segments` });
  } catch (err) {
    stages.push({ name: "variant playlist", ok: false, detail: String(err instanceof Error ? err.message : err) });
    return { stages, radarrId };
  }

  try {
    const res = await fetchJellyfinResource(masterUrl, itemId, segmentRefs[0]);
    const bytes = (await res.arrayBuffer()).byteLength;
    if (!res.ok || bytes < SEGMENT_MIN_BYTES) throw new Error(`HTTP ${res.status}, ${bytes} bytes`);
    stages.push({ name: "first segment", ok: true, detail: `${bytes.toLocaleString()} bytes` });
  } catch (err) {
    stages.push({ name: "first segment", ok: false, detail: String(err instanceof Error ? err.message : err) });
    return { stages, radarrId };
  }

  // Proves seeking, not just start -- the exact class of bug that shipped
  // three times in one session (mediaSourceId, then Jellyfin rejecting
  // startTimeTicks on the segment endpoint specifically) only reproduced on
  // a segment away from the very beginning.
  try {
    const ref = segmentRefs[Math.min(FAR_SEGMENT_INDEX, segmentRefs.length - 1)];
    const res = await fetchJellyfinResource(masterUrl, itemId, ref);
    const bytes = (await res.arrayBuffer()).byteLength;
    if (!res.ok || bytes < SEGMENT_MIN_BYTES) throw new Error(`HTTP ${res.status}, ${bytes} bytes`);
    stages.push({ name: "seek (far segment)", ok: true, detail: `${bytes.toLocaleString()} bytes` });
  } catch (err) {
    stages.push({ name: "seek (far segment)", ok: false, detail: String(err instanceof Error ? err.message : err) });
    return { stages, radarrId };
  }

  return { stages, radarrId };
}

export type PlaybackCheckResult = {
  success: boolean;
  summary: string;
  detail: string;
  testTitle: string;
  durationMs: number;
};

export type PlaybackCheckRunSummary = {
  id: string;
  ranAt: string;
  success: boolean;
  summary: string;
  detail: string;
  testTitle: string | null;
  durationMs: number | null;
  notified: boolean;
};

/** Recent runs, newest first, for the admin panel -- see PlaybackCheckPanel. */
export async function getPlaybackCheckHistory(limit = 20): Promise<PlaybackCheckRunSummary[]> {
  const runs = await prisma.playbackCheckRun.findMany({
    orderBy: { ranAt: "desc" },
    take: limit,
  });
  return runs.map((r) => ({
    id: r.id,
    ranAt: r.ranAt.toISOString(),
    success: r.success,
    summary: r.summary,
    detail: r.detail,
    testTitle: r.testTitle,
    durationMs: r.durationMs,
    notified: r.notified,
  }));
}

export async function runPlaybackCheck(): Promise<PlaybackCheckResult> {
  const startedAt = Date.now();
  let stages: Stage[] = [];
  let radarrId: number | null = null;
  try {
    const result = await runStages();
    stages = result.stages;
    radarrId = result.radarrId;
  } finally {
    // Always clean up, pass or fail -- see the module doc for why.
    if (radarrId != null) {
      await deleteRadarrMovie(radarrId).catch((err) => console.error("[playbackCheck] cleanup failed:", err));
    }
  }

  const success = stages.length > 0 && stages.every((s) => s.ok);
  const passed = stages.filter((s) => s.ok).length;
  const firstFailure = stages.find((s) => !s.ok);
  const summary = success
    ? `${passed}/${stages.length} stages passed`
    : `failed at ${firstFailure?.name ?? "startup"}`;
  const detail = stages.map((s) => `${s.ok ? "PASS" : "FAIL"}  ${s.name}: ${s.detail}`).join("\n");
  const durationMs = Date.now() - startedAt;

  const run = await prisma.playbackCheckRun.create({
    data: { success, summary, detail, testTitle: TEST_MOVIE_LABEL, durationMs, notified: false },
  });

  if (!success && isNotifyConfigured()) {
    const sent = await notify(
      `Playback check failed: ${summary}`,
      `${TEST_MOVIE_LABEL}\n\n${detail}\n\nRan in ${Math.round(durationMs / 1000)}s.`
    );
    if (sent) {
      await prisma.playbackCheckRun.update({ where: { id: run.id }, data: { notified: true } });
    }
  }

  return { success, summary, detail, testTitle: TEST_MOVIE_LABEL, durationMs };
}
