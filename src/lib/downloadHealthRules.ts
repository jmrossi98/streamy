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

// How long a torrent that already has data may sit without moving a piece
// before it is given up on.
export const STALL_PATIENCE_MINUTES = 20;

// Longer clock for entries that are merely still starting up.
export const TRANSIENT_GRACE_MINUTES = 30;

export type DownloadHealth = {
  /** Radarr/Sonarr's own diagnosis, e.g. "stalled with no connections". */
  errorMessage: string | null;
  /** The queue record's status ("downloading", "queued", "paused", ...). */
  clientStatus?: string | null;
  /** qBittorrent's own state for a torrent ("metaDL", "queuedDL", ...), when known. */
  torrentState?: string | null;
  /** How long the entry has been sitting in the queue. */
  ageMinutes: number;
  hasProgress: boolean;
  /** "usenet" or "torrent", when known. */
  protocol?: string | null;
  /** Minutes since a torrent last moved a piece, when the client said. */
  idleMinutes?: number | null;
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

/**
 * Queue statuses that mean "waiting for its turn", not "dead".
 *
 * SABnzbd downloads one job at a time, so with nine 5 GB Sopranos episodes
 * grabbed together, the last one sits at 0% for ~45 minutes -- and "no
 * progress after 12 minutes" read that as a stall. The healer cancelled it,
 * re-searched, usually re-grabbed the same release onto the *back* of the
 * queue, and after a few rounds blocklisted a perfectly good release and
 * pushed the episode onto a worse one or a torrent. "paused" is a person or
 * SAB's own low-disk guard; "delay" is Sonarr holding a release back on
 * purpose. None of these is the release's fault.
 */
const WAITING_STATUSES = new Set(["queued", "paused", "delay"]);

// qBittorrent states that really are "waiting". Not metaDL: Sonarr reports a
// torrent still fetching its metadata as "queued" too, and The Sopranos
// S05E05 sat 50 minutes in metaDL, shielded by the waiting rule.
const TORRENT_WAITING_STATES = new Set([
  "queueddl", "pauseddl", "stoppeddl", "checkingdl", "checkingresumedata", "allocating", "moving",
]);

export function isWaitingItsTurn(
  status: string | null | undefined,
  torrentState?: string | null
): boolean {
  if (torrentState) return TORRENT_WAITING_STATES.has(torrentState.toLowerCase());
  return !!status && WAITING_STATUSES.has(status.toLowerCase());
}

/**
 * A torrent that has not even fetched its metadata in this long has no
 * reachable peer and will not start. Ten minutes is the whole request-to-ready
 * budget, so it is replaced rather than waited on.
 */
export const METADATA_DEAD_MINUTES = 10;

export function isMetadataDead(entry: { torrentState?: string | null; ageMinutes: number }): boolean {
  return (entry.torrentState ?? "").toLowerCase() === "metadl" && entry.ageMinutes >= METADATA_DEAD_MINUTES;
}

/** How long a finished download may fail to import before it is replaced. */
export const IMPORT_STUCK_MINUTES = 30;

/**
 * Whether a finished download is stuck unable to import.
 *
 * Sonarr leaves such an entry at "importPending"/"importBlocked" with a
 * warning forever: The Sopranos S04E09 sat 11 hours on "Unable to determine
 * if file is a sample" because the .mkv was zeros from byte 0 -- corrupt, so
 * no amount of waiting would import it, and the queue-based healer never
 * looked at it because it had "progress" (it was 100% done). Only the
 * current state is judged here; the caller supplies how long it has been
 * seen stuck, so a warning that clears on its own is never acted on.
 */
export function isImportStuck(entry: {
  clientStatus?: string | null;
  trackedDownloadState?: string | null;
  trackedDownloadStatus?: string | null;
}): boolean {
  const state = (entry.trackedDownloadState ?? "").toLowerCase();
  const status = (entry.trackedDownloadStatus ?? "").toLowerCase();
  return (
    (entry.clientStatus ?? "").toLowerCase() === "completed" &&
    ["importpending", "importblocked", "importfailed"].includes(state) &&
    (status === "warning" || status === "error")
  );
}

/** Whether a queue entry is dead enough to be worth dropping and re-grabbing. */
export function isUnhealthy(entry: DownloadHealth): boolean {
  if (isMetadataDead(entry)) return true;
  if (entry.ageMinutes < STALL_GRACE_MINUTES) return false;
  if (isWaitingItsTurn(entry.clientStatus, entry.torrentState)) return false;
  // A transient status still has to go somewhere eventually, so it is judged
  // on a longer clock rather than exempted -- a torrent that cannot find
  // metadata in half an hour is not going to.
  if (entry.errorMessage && isTransient(entry.errorMessage)) {
    return entry.ageMinutes >= TRANSIENT_GRACE_MINUTES;
  }
  // A torrent that has data and moved a piece recently is between peers, not
  // dead. "Stalled" is reported the moment the last peer drops, and dropping
  // the release then throws away what it has: every drop is blocklisted now
  // (healLoopRules.ts), so it would not be picked up again where it left off.
  if (
    entry.errorMessage &&
    /stalled/i.test(entry.errorMessage) &&
    entry.hasProgress &&
    entry.idleMinutes != null &&
    entry.idleMinutes < STALL_PATIENCE_MINUTES
  ) {
    return false;
  }
  // An explicit error from Radarr/Sonarr ("stalled with no connections",
  // "qBittorrent is reporting an error") is reason enough.
  if (entry.errorMessage) return true;
  // A usenet job at 0% with no error is waiting behind the jobs ahead of it,
  // and its status cannot say so: SABnzbd reports every job in its queue as
  // "Downloading", not only the one it is working on. Fifteen movies requested
  // together on 2026-10-04 put ~40 GB in front of the last of them, and each
  // one still at 0% after the grace period was cancelled, re-grabbed onto the
  // back of the queue, and blocklisted on its second turn -- good releases,
  // lost for nothing, with the movie no nearer to done. Usenet does not stall
  // the way a swarm does: SABnzbd finishes a job or fails it, and a failure
  // arrives as an error, handled above.
  if ((entry.protocol ?? "").toLowerCase() === "usenet") return false;
  // No error reported, but still hasn't moved a single byte well past the
  // grace period -- effectively dead too.
  return !entry.hasProgress;
}

// Radarr/Sonarr's wording when a finished download is no better than the file
// already in the library ("Not an upgrade for existing movie file. Existing
// quality: Bluray-2160p. New Quality Bluray-1080p.", and the custom-format
// variant).
const NOT_AN_UPGRADE = /^not an? (?:custom format )?upgrade for existing/i;

/**
 * Whether a finished download is simply surplus: the title already has a file
 * at least as good, so this one will never import.
 *
 * This is how a fast usenet copy ends when the torrent it was started
 * alongside finishes first. Nothing is wrong with the release, so it is
 * removed without blocklisting and without a new search -- waiting out
 * IMPORT_STUCK_MINUTES and then replacing it, as for a corrupt file, would
 * blocklist a good release and search for a title that is already there.
 */
export function isRedundantImport(entry: {
  clientStatus?: string | null;
  statusMessages: string[];
}): boolean {
  return (
    (entry.clientStatus ?? "").toLowerCase() === "completed" &&
    entry.statusMessages.length > 0 &&
    entry.statusMessages.every((m) => NOT_AN_UPGRADE.test(m.trim()))
  );
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

/**
 * Why a release must never be taken again.
 *
 * "executable" is detected: a finished download whose payload is a program
 * rather than a video. "cancelledByAdmin" is chosen: an admin cancelled it by
 * hand, which is the strongest signal there is and outranks any scoring
 * Sonarr would do. Both are recorded in the same table because both answer the
 * same question at blocklist-expiry time -- is this one allowed back? -- but
 * only the detected kind is ever described to a viewer as unsafe.
 */
export type BadReleaseReason = "executable" | "cancelledByAdmin";

/** The reasons that mean the payload itself was bad, as opposed to unwanted. */
export const UNSAFE_REASONS = ["executable"] as const satisfies readonly BadReleaseReason[];

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

/** A torrent no seeder anywhere can finish: none connected and none in the swarm. */
export function isDeadSwarm(t: { swarmSeeds: number; connectedSeeds: number } | undefined): boolean {
  return !!t && t.swarmSeeds === 0 && t.connectedSeeds === 0;
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

/**
 * Most idle episodes the healer re-searches in one Sonarr command.
 *
 * On 2026-09-28 it fired one EpisodeSearch for 28 episodes -- bonus specials
 * no indexer carries -- which ran for minutes while five Sopranos episodes
 * Jake had just requested waited behind it for ~25 minutes. A search costs
 * ~17s per episode on an idle Sonarr, so five keeps any one healer command
 * under a couple of minutes; the rest get their turn on later passes.
 */
export const IDLE_EPISODE_BATCH = 5;

/**
 * Which idle episodes to re-search this pass: those off cooldown, fewest
 * previous tries first (a title that keeps coming up empty yields to one
 * that has barely been tried), capped at `max`.
 */
export function pickIdleEpisodeBatch<T extends { episodeId: number }>(
  candidates: T[],
  triesOf: (e: T) => number,
  onCooldown: (e: T) => boolean,
  max: number = IDLE_EPISODE_BATCH
): T[] {
  return candidates
    .filter((e) => !onCooldown(e))
    .map((e, i) => ({ e, i, tries: triesOf(e) }))
    .sort((a, b) => a.tries - b.tries || a.i - b.i)
    .slice(0, max)
    .map((x) => x.e);
}
