/**
 * Live progress for every transfer the download clients hold, keyed by the
 * id the *arr queues carry (see liveProgressRules.ts). Server-side only.
 *
 * Both reads are shared for a couple of seconds, so the downloads panel's
 * refreshes and the healer never ask the clients more than once per tick.
 */
import { getSabProgress } from "./sabnzbd";
import { getTorrentProgress } from "./qbittorrent";
import type { ClientProgress } from "./liveProgressRules";

export async function getClientProgress(): Promise<ClientProgress> {
  const [sab, torrents] = await Promise.all([getSabProgress(), getTorrentProgress()]);
  return new Map([...sab, ...torrents]);
}
