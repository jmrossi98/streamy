/**
 * Setting a Jellyfin password signs out every device on that account (the
 * Roku and phone apps then show a home page that never loads), even when the
 * new password is the old one. So it is set only when this pair has never
 * been pushed, or the Streamy password changed since the last push.
 */
export function passwordPushNeeded(
  row: { jellyfinUserId: string | null; jellyfinPasswordSyncedAt: Date | null; passwordChangedAt: Date | null } | null,
  jellyfinUserId: string
): boolean {
  if (!row || row.jellyfinUserId !== jellyfinUserId || !row.jellyfinPasswordSyncedAt) return true;
  return !!row.passwordChangedAt && row.passwordChangedAt > row.jellyfinPasswordSyncedAt;
}
