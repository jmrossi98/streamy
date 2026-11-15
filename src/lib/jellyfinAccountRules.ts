/**
 * Setting a Jellyfin password signs out every device on that account (the
 * Roku and phone apps then show a home page that never loads), even when the
 * new password is the old one. So it is set only when this pair has never
 * been pushed, or the Streamy password changed since the last push.
 */
/**
 * Where the Jellyfin apps (Roku, phone, TV) reach the server from anywhere:
 * the Cloudflare tunnel to mediabox, live since 2026-08-26. JELLYFIN_PUBLIC_URL
 * overrides it.
 */
export const JELLYFIN_APP_ADDRESS_DEFAULT = "https://media.streamy-app.com";

/**
 * Whether the person's Jellyfin password is their Streamy password right now:
 * the accounts are linked, the password was pushed, and it hasn't changed in
 * Streamy since. Otherwise it is set at their next Streamy sign-in.
 */
export function jellyfinPasswordIsStreamys(
  row: { jellyfinUserId: string | null; jellyfinPasswordSyncedAt: Date | null; passwordChangedAt: Date | null } | null
): boolean {
  return !!row?.jellyfinUserId && !passwordPushNeeded(row, row.jellyfinUserId);
}

export function passwordPushNeeded(
  row: { jellyfinUserId: string | null; jellyfinPasswordSyncedAt: Date | null; passwordChangedAt: Date | null } | null,
  jellyfinUserId: string
): boolean {
  if (!row || row.jellyfinUserId !== jellyfinUserId || !row.jellyfinPasswordSyncedAt) return true;
  return !!row.passwordChangedAt && row.passwordChangedAt > row.jellyfinPasswordSyncedAt;
}
