/**
 * Decision rules for the download auto-healer.
 *
 * Deliberately separate from downloadHealer.ts, which reaches out to
 * Radarr/Sonarr/qBittorrent: this file is pure policy with no imports, so the
 * rules can be tested directly without dragging in the whole client stack.
 */

// Grace period before touching anything: a torrent legitimately takes a
// little while to find peers and pull metadata, and we don't want to kill a
// download that was about to start moving.
export const STALL_GRACE_MINUTES = 12;

// Longer clock for entries that are merely still starting up.
export const TRANSIENT_GRACE_MINUTES = 30;

export type DownloadHealth = {
  /** Radarr/Sonarr's own diagnosis, e.g. "stalled with no connections". */
  errorMessage: string | null;
  /** How long the entry has been sitting in the queue. */
  ageMinutes: number;
  hasProgress: boolean;
};

// Messages Radarr/Sonarr put in the same field as real errors that are
// actually just "this is still starting up". A torrent has no metadata until
// it finds a peer with one, which on a thin swarm legitimately takes a while
// -- treating that as a failure killed torrents during the one phase where
// having no progress is expected, then re-grabbed the same release into the
// same state.
const TRANSIENT_STATUSES = ["downloading metadata", "pending", "queued", "delay"];

function isTransient(message: string): boolean {
  const m = message.toLowerCase();
  return TRANSIENT_STATUSES.some((t) => m.includes(t));
}

/** Whether a queue entry is dead enough to be worth dropping and re-grabbing. */
export function isUnhealthy(entry: DownloadHealth): boolean {
  if (entry.ageMinutes < STALL_GRACE_MINUTES) return false;
  // A transient status still has to go somewhere eventually, so it is judged
  // on a longer clock rather than exempted -- a torrent that cannot find
  // metadata in half an hour is not going to.
  if (entry.errorMessage && isTransient(entry.errorMessage)) {
    return entry.ageMinutes >= TRANSIENT_GRACE_MINUTES;
  }
  // An explicit error from Radarr/Sonarr ("stalled with no connections",
  // "qBittorrent is reporting an error") is reason enough.
  if (entry.errorMessage) return true;
  // No error reported, but still hasn't moved a single byte well past the
  // grace period -- effectively dead too.
  return !entry.hasProgress;
}

/**
 * Whether a dropped release should also be blocklisted.
 *
 * Blocklisting is permanent, so it's reserved for releases that genuinely
 * failed. A plain stall is usually about conditions -- a VPN reconnect, a
 * brief peer drought -- and blocklisting those poisoned the healthiest
 * releases, pushing later searches onto worse-seeded ones.
 */
export function shouldBlocklist(errorMessage: string | null): boolean {
  return /error|failed|corrupt/i.test(errorMessage ?? "");
}

/** Why a finished download was thrown away as unusable. Only "executable" for
 *  now; a union so a new reason is a type error everywhere it needs a label. */
export type BadReleaseReason = "executable";

export type QueueItemMessages = { statusMessages?: { messages?: string[] }[] };

// Radarr/Sonarr's own wording once a completed download turns out to hold
// something that isn't media: "Caution: Found executable file with extension:
// '.exe'" and "...potentially dangerous file with extension...". Real
// occurrence this exists for: a "1080p AMZN WEB-DL" of a film still in
// cinemas whose entire payload was one 1.1 GB .exe. Radarr refuses to import
// it but leaves it in the queue forever, so it sat at 100% looking merely slow.
const UNSAFE_FILE_PATTERN = /(?:executable|potentially dangerous) file/i;

/**
 * Whether a queue entry is a release that must never be imported or kept.
 *
 * Deliberately narrow: only a file the app itself calls dangerous. A quality
 * rejection, a missing file or a "matched by ID" confidence block can all be
 * legitimate releases that need a human, and throwing those away would be
 * wrong -- see isConfidenceBlockedQueueItem in radarr.ts.
 */
export function classifyBadRelease(item: QueueItemMessages): BadReleaseReason | null {
  const messages = (item.statusMessages ?? []).flatMap((sm) => sm.messages ?? []);
  return messages.some((m) => UNSAFE_FILE_PATTERN.test(m)) ? "executable" : null;
}

/** Lowercased, punctuation-free form of a release name, for comparing the
 *  same release as spelled by the queue, the blocklist and our own records. */
export function normalizeReleaseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Whether two spellings name the same release. The queue reports the torrent's
 * own name (".exe" suffix included) while the blocklist stores the release
 * title without it, so an exact match alone would miss exactly the entries this
 * matters for -- a prefix on a word boundary covers that without conflating
 * two different releases.
 */
export function sameRelease(a: string, b: string): boolean {
  const x = normalizeReleaseTitle(a);
  const y = normalizeReleaseTitle(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

export type RejectedReleaseKey = { releaseTitle: string; downloadId: string | null };
export type BlocklistRecord = { sourceTitle?: string; torrentInfoHash?: string | null };

/**
 * Whether a blocklist entry is one we rejected as unsafe. The healer expires
 * old blocklist entries so a good release blocked by a transient stall becomes
 * eligible again -- that must never apply to a release that was never good.
 */
export function isPermanentlyBlocked(
  record: BlocklistRecord,
  rejected: readonly RejectedReleaseKey[]
): boolean {
  const hash = record.torrentInfoHash?.toLowerCase();
  return rejected.some(
    (r) =>
      (hash != null && r.downloadId != null && r.downloadId.toLowerCase() === hash) ||
      (record.sourceTitle != null && sameRelease(record.sourceTitle, r.releaseTitle))
  );
}

// After a rejection the healer searches again straight away, so the next
// alternative is found in seconds instead of after the next scan. This bounds
// that chain: a title whose every release is a fake would otherwise download
// one after another indefinitely. Past the cap it falls back to the slower
// idle-title retry, which still keeps trying, just not back to back.
export const MAX_IMMEDIATE_RESEARCHES_PER_HOUR = 5;

export function shouldSearchImmediately(rejectionsInLastHour: number): boolean {
  return rejectionsInLastHour <= MAX_IMMEDIATE_RESEARCHES_PER_HOUR;
}

// Don't re-heal the same title repeatedly -- if a fresh grab also goes bad,
// wait before trying again so we don't churn through every release on the
// indexer in a tight loop.
export const REHEAL_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_IDLE_BACKOFF_MS = 24 * 60 * 60 * 1000;

/**
 * How long to wait before the nth consecutive idle re-search of one title:
 * 15m, 30m, 1h, 2h ... capped at a day.
 *
 * A flat cooldown here meant a title nobody can supply was retried forever.
 * Gurren Lagann's 20 specials are the case that exposed it: obscure enough
 * that no indexer carries a usable release, monitored, and therefore "wanted
 * but nothing in flight" permanently -- 198 episode searches in four hours,
 * re-grabbing the same two unusable releases each time.
 *
 * Those grabs never reach the queue ("Couldn't add release ... to download
 * queue"), so Sonarr never records a failed download and never blocklists
 * them. Blocklisting alone would not have stopped this.
 *
 * Capped rather than abandoned, because "no release exists" is a statement
 * about today. Specials get scene releases years late, and a title that gave
 * up permanently would never notice.
 */
export function idleBackoffMs(tries: number): number {
  if (tries <= 1) return REHEAL_COOLDOWN_MS;
  return Math.min(REHEAL_COOLDOWN_MS * 2 ** (tries - 1), MAX_IDLE_BACKOFF_MS);
}
