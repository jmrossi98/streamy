/**
 * The ledger of the healer's re-searches, one row per wanted episode or
 * movie, and the give-ups it leads to -- see searchGiveUpRules.ts for why.
 *
 * Server-only: this touches the database. The healer loads it with a dynamic
 * import so its own tests stay off the database.
 */
import { prisma } from "./db";
import { logAudit } from "./auditLog";
import { GIVE_UP_SHOWN_MS, type SearchLedgerEntry } from "./searchGiveUpRules";

export type LedgerItem = {
  /** "episode:<sonarr episode id>" or "movie:<radarr movie id>". */
  key: string;
  mediaType: "movie" | "show";
  externalId: number;
  episodeId: number | null;
  /** "Show - S1 E3 - Title" or the movie's title. */
  label: string;
};

export type GivenUp = LedgerItem & SearchLedgerEntry & { gaveUpAt: Date };

export const movieKey = (radarrId: number) => `movie:${radarrId}`;
export const episodeKey = (episodeId: number) => `episode:${episodeId}`;

/** The entries for these keys; a key with no row is simply absent. */
export async function searchLedger(keys: string[]): Promise<Map<string, SearchLedgerEntry>> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.wantedSearch.findMany({
    where: { key: { in: keys } },
    select: { key: true, firstSearchedAt: true, lastSearchedAt: true, searches: true, gaveUpAt: true },
  });
  return new Map(rows.map((r) => [r.key, r]));
}

/** One more search for each of these, started now. */
export async function recordSearches(items: LedgerItem[]): Promise<void> {
  const now = new Date();
  for (const item of items) {
    await prisma.wantedSearch.upsert({
      where: { key: item.key },
      create: { ...item, searches: 1, firstSearchedAt: now, lastSearchedAt: now },
      update: { label: item.label, searches: { increment: 1 }, lastSearchedAt: now },
    });
  }
}

/** Records the give-up and writes it to the audit log. */
export async function markGivenUp(key: string, title: string, reason: string): Promise<void> {
  await prisma.wantedSearch.update({ where: { key }, data: { gaveUpAt: new Date() } });
  await logAudit("healer", "downloads.give-up", title, reason);
}

/** Forgets the entry: the title was asked for again and starts from zero. */
export async function resetSearch(key: string): Promise<void> {
  await prisma.wantedSearch.deleteMany({ where: { key } });
}

/** The give-ups recent enough for the downloads panel, newest first. */
export async function recentGiveUps(now: number = Date.now()): Promise<GivenUp[]> {
  const rows = await prisma.wantedSearch.findMany({
    where: { gaveUpAt: { gte: new Date(now - GIVE_UP_SHOWN_MS) } },
    orderBy: { gaveUpAt: "desc" },
  });
  return rows.filter((r): r is typeof r & { gaveUpAt: Date } => r.gaveUpAt != null).map((r) => ({
    ...r,
    mediaType: r.mediaType === "movie" ? "movie" : "show",
  }));
}
