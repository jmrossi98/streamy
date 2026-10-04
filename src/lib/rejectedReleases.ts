import { prisma } from "./db";
import {
  sameRelease,
  UNSAFE_REASONS,
  type BadReleaseReason,
  type RejectedReleaseKey,
} from "./downloadHealthRules";
import type { RejectionSummary } from "./requestNotice";
import { REPEAT_WINDOW_MS, REPLACED_REASON, type HealScope, type Replacement } from "./healLoopRules";

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
    // Not the healer's own replacement log: a release it once dropped for
    // stalling can still turn out to be unsafe, and must be recorded as such.
    where: { mediaType: input.mediaType, externalId: input.externalId, reason: { not: REPLACED_REASON } },
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

/**
 * Releases that must never come back, for the blocklist expiry to skip:
 * the ones rejected because the payload itself was bad.
 *
 * Not admin cancels. They used to be kept here on the theory that a hand
 * cancel is the most deliberate rejection there is -- but cancelling means
 * "I don't want this title right now", not "this release is bad", and the
 * permanent block followed the title into later, deliberate requests, leaving
 * them with worse releases or none (decided 2026-10-02).
 */
export async function getPermanentBlocks(): Promise<RejectedReleaseKey[]> {
  return prisma.rejectedRelease.findMany({
    where: { reason: { in: [...UNSAFE_REASONS] } },
    select: { releaseTitle: true, downloadId: true },
  });
}

/**
 * Releases blocklisted only because someone cancelled them, from before
 * cancels stopped blocklisting. The healer unblocks these at once -- whatever
 * their age -- and then forgets them.
 */
export async function getCancelBlocks(): Promise<(RejectedReleaseKey & { id: number })[]> {
  return prisma.rejectedRelease.findMany({
    where: { reason: "cancelledByAdmin" },
    select: { id: true, releaseTitle: true, downloadId: true },
  });
}

export async function forgetCancelBlocks(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.rejectedRelease.deleteMany({ where: { id: { in: ids } } });
}

/**
 * How many releases were rejected for this title in the last hour.
 *
 * Unsafe reasons only. This bounds the healer's back-to-back re-searching, and
 * an admin cancelling something by hand is not a sign that the title keeps
 * producing fakes -- counting it would throttle the search for the good
 * release the admin is waiting for.
 */
export async function countRecentRejections(mediaType: MediaType, externalId: number): Promise<number> {
  return prisma.rejectedRelease.count({
    where: {
      mediaType,
      externalId,
      reason: { in: [...UNSAFE_REASONS] },
      createdAt: { gte: new Date(Date.now() - 3600_000) },
    },
  });
}

/** The rejections a viewer should be told about for this title, or null. */
export async function getRejectionSummary(
  mediaType: MediaType,
  externalId: number
): Promise<RejectionSummary | null> {
  // Unsafe reasons only: the notice reads "rejected as unsafe", which an
  // admin's own deliberate cancel is not.
  const rows = await prisma.rejectedRelease.findMany({
    where: {
      mediaType,
      externalId,
      reason: { in: [...UNSAFE_REASONS] },
      createdAt: { gte: new Date(Date.now() - NOTICE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { reason: true },
  });
  if (rows.length === 0) return null;
  return { count: rows.length, reason: rows[0].reason as BadReleaseReason };
}

/**
 * Notes a release the healer dropped and replaced -- see healLoopRules.ts.
 * One row per drop, deliberately not idempotent: the count is the point.
 */
export async function recordReplacement(input: {
  mediaType: HealScope;
  externalId: number;
  releaseTitle: string;
  downloadId: string | null;
}): Promise<void> {
  await prisma.rejectedRelease.create({ data: { ...input, reason: REPLACED_REASON } });
}

/** Every release dropped and replaced in the last week. */
export async function getReplacements(): Promise<Replacement[]> {
  return prisma.rejectedRelease.findMany({
    where: { reason: REPLACED_REASON, createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) } },
    select: { mediaType: true, externalId: true, releaseTitle: true, downloadId: true, createdAt: true },
  });
}

/** How many releases were dropped and replaced for each of these titles in the last day. */
export async function countReplacements(mediaType: HealScope, externalIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (externalIds.length === 0) return counts;
  const rows = await prisma.rejectedRelease.findMany({
    where: {
      mediaType,
      externalId: { in: externalIds },
      reason: REPLACED_REASON,
      createdAt: { gte: new Date(Date.now() - NOTICE_WINDOW_MS) },
    },
    select: { externalId: true },
  });
  for (const r of rows) counts.set(r.externalId, (counts.get(r.externalId) ?? 0) + 1);
  return counts;
}
