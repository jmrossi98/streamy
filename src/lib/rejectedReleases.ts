import { prisma } from "./db";
import {
  sameRelease,
  type BadReleaseReason,
  type RejectedReleaseKey,
} from "./downloadHealthRules";
import type { RejectionSummary } from "./requestNotice";

type MediaType = "movie" | "show";

// How far back a rejection still counts as "what happened to this request".
// A day covers a search that drags on; older than that the title is a fresh
// attempt and a stale "1 release rejected" would only confuse.
const NOTICE_WINDOW_MS = 24 * 3600_000;

/**
 * Notes a release as rejected. Idempotent per release: the healer can see the
 * same queue entry again if removing it failed, and a second row would inflate
 * the count shown to the viewer.
 */
export async function recordRejection(input: {
  mediaType: MediaType;
  externalId: number;
  releaseTitle: string;
  downloadId: string | null;
  reason: BadReleaseReason;
}): Promise<void> {
  const existing = await prisma.rejectedRelease.findMany({
    where: { mediaType: input.mediaType, externalId: input.externalId },
    select: { releaseTitle: true, downloadId: true },
  });
  const seen = existing.some(
    (r) =>
      (input.downloadId != null && r.downloadId === input.downloadId) ||
      sameRelease(r.releaseTitle, input.releaseTitle)
  );
  if (seen) return;
  await prisma.rejectedRelease.create({ data: input });
}

/** Every release we have ever rejected, for the blocklist expiry to skip. */
export async function getPermanentBlocks(): Promise<RejectedReleaseKey[]> {
  return prisma.rejectedRelease.findMany({ select: { releaseTitle: true, downloadId: true } });
}

/** How many releases were rejected for this title in the last hour. */
export async function countRecentRejections(mediaType: MediaType, externalId: number): Promise<number> {
  return prisma.rejectedRelease.count({
    where: { mediaType, externalId, createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
}

/** The rejections a viewer should be told about for this title, or null. */
export async function getRejectionSummary(
  mediaType: MediaType,
  externalId: number
): Promise<RejectionSummary | null> {
  const rows = await prisma.rejectedRelease.findMany({
    where: { mediaType, externalId, createdAt: { gte: new Date(Date.now() - NOTICE_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    select: { reason: true },
  });
  if (rows.length === 0) return null;
  return { count: rows.length, reason: rows[0].reason as BadReleaseReason };
}
