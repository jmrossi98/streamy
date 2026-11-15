/**
 * Sonarr's per-series episode lists and each episode's download protocol,
 * kept on disk so a restart starts warm. Server-side only.
 *
 * The admin Downloads panel builds its finished-TV rows from one episode list
 * per series (sonarr.ts, seriesEpisodes) plus a protocol per episode from
 * grab history. Held only in memory, every deploy threw all of it away, and
 * the first person to open the panel afterwards paid for refetching 94
 * series' lists and as many series histories: about a minute against a busy
 * Sonarr on 2026-11-15, with only the in-flight rows on screen until it
 * finished ("only shows SpongeBob"). Restored from here, a list is reused
 * for as long as its series' file statistics read the same, exactly as it
 * would have been had the process never restarted.
 *
 * One JSON file, written a minute after the last change (temp file and
 * rename, so a crash mid-write leaves the old one). A missing, unreadable or
 * older-format file is ignored: the cost is one slow first refresh, never a
 * wrong row.
 */
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DownloadProtocol } from "./historyProtocolRules";

/** One episode, cut down to the fields the downloads panel reads. */
export type StoredEpisode = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  hasFile: boolean;
  monitored: boolean;
  airDateUtc?: string | null;
  episodeFile?: { relativePath?: string; size?: number; dateAdded?: string } | null;
};

/** A series' episode list and the file statistics it was read under. */
export type StoredList = { signature: string; at: number; episodes: StoredEpisode[] };

export type EpisodeStore = {
  lists: Map<number, StoredList>;
  /** Episode id -> protocol of its latest grab; "unknown" when it has a file and no grab on record. */
  protocols: Map<number, DownloadProtocol>;
};

const FORMAT = 1;
const SAVE_DELAY_MS = 60_000;
const PROTOCOLS: readonly DownloadProtocol[] = ["usenet", "torrent", "unknown"];

/** Sonarr's episode resource (with its embedded file) reduced to StoredEpisode. Pure. */
export function compactEpisode(e: StoredEpisode): StoredEpisode {
  const f = e.episodeFile;
  return {
    id: e.id,
    seasonNumber: e.seasonNumber,
    episodeNumber: e.episodeNumber,
    title: e.title ?? "",
    hasFile: e.hasFile,
    monitored: e.monitored,
    airDateUtc: e.airDateUtc ?? null,
    episodeFile: f ? { relativePath: f.relativePath, size: f.size, dateAdded: f.dateAdded } : null,
  };
}

function isEpisode(e: unknown): e is StoredEpisode {
  const x = e as StoredEpisode;
  return (
    typeof x === "object" &&
    x !== null &&
    Number.isInteger(x.id) &&
    Number.isInteger(x.seasonNumber) &&
    Number.isInteger(x.episodeNumber) &&
    typeof x.hasFile === "boolean" &&
    typeof x.monitored === "boolean"
  );
}

/**
 * The file's contents, checked entry by entry: a list or protocol that does
 * not look right is dropped, and a file of another format is ignored whole.
 * Pure.
 */
export function parseEpisodeStore(text: string): EpisodeStore {
  const out: EpisodeStore = { lists: new Map(), protocols: new Map() };
  let raw: { format?: unknown; lists?: unknown; protocols?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (!raw || raw.format !== FORMAT) return out;
  for (const [id, list] of Object.entries((raw.lists ?? {}) as Record<string, Partial<StoredList>>)) {
    const seriesId = Number(id);
    if (!Number.isInteger(seriesId) || !list || typeof list.signature !== "string" || typeof list.at !== "number") continue;
    if (!Array.isArray(list.episodes) || list.episodes.length === 0 || !list.episodes.every(isEpisode)) continue;
    out.lists.set(seriesId, { signature: list.signature, at: list.at, episodes: list.episodes });
  }
  for (const [id, protocol] of Object.entries((raw.protocols ?? {}) as Record<string, unknown>)) {
    const episodeId = Number(id);
    if (Number.isInteger(episodeId) && PROTOCOLS.includes(protocol as DownloadProtocol)) {
      out.protocols.set(episodeId, protocol as DownloadProtocol);
    }
  }
  return out;
}

/** The store as the file holds it. Pure. */
export function serializeEpisodeStore(store: EpisodeStore): string {
  return JSON.stringify({
    format: FORMAT,
    lists: Object.fromEntries(store.lists),
    protocols: Object.fromEntries(store.protocols),
  });
}

function storeFile(): string {
  return path.join(process.env.SONARR_CACHE_DIR || "/app/data/sonarr-cache", "episode-lists.json");
}

let store: EpisodeStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** The store, read from disk on first use. */
export function episodeStore(): EpisodeStore {
  if (store) return store;
  try {
    store = parseEpisodeStore(readFileSync(storeFile(), "utf8"));
  } catch {
    // No file yet (first run, or a dev machine): start empty.
    store = { lists: new Map(), protocols: new Map() };
  }
  return store;
}

async function save(): Promise<void> {
  saveTimer = null;
  if (!store) return;
  const file = storeFile();
  const tmp = `${file}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, serializeEpisodeStore(store));
    await rename(tmp, file);
  } catch (err) {
    console.error("[sonarr] could not save the episode-list cache:", err instanceof Error ? err.message : err);
  }
}

/** Writes the store a minute from now, once for any number of changes in between. */
export function scheduleEpisodeStoreSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
  saveTimer.unref?.();
}
