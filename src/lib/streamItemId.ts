/**
 * The Jellyfin item behind a stream URL, remembered between requests.
 *
 * One playback is many requests to the same route: a Range request per seek
 * for direct play, and for a transcode the master playlist, the variant and
 * then a segment every three seconds. Each of them looked the item up from
 * scratch -- the whole series list plus the season for an episode, the whole
 * movie library for a movie -- before a byte was proxied. Measured at about
 * 200 ms a request on a quiet Jellyfin, and it was added to every one.
 *
 * A remembered id can go stale when a file is replaced by an upgrade, so a
 * stream Jellyfin refuses forgets it and the next request looks again.
 */
import { findJellyfinEpisodeItemId, findJellyfinMovieItemId } from "./jellyfin";
import { cachedItemId, forgetItemId } from "./jellyfinItemIdCache";
import { findJellyfinRecordingItemId, getSportarrEvent } from "./sportarr";

const episodeKey = (showId: string, season: number, episode: number) => `ep:${showId}:${season}:${episode}`;
const movieKey = (tmdbId: string) => `movie:${tmdbId}`;
const recordingKey = (eventId: number) => `recording:${eventId}`;

/** A game recording's item, by Sportarr event id (see sportarr.ts for the lookup). */
export function streamRecordingItemId(eventId: number): Promise<string | null> {
  return cachedItemId(recordingKey(eventId), async () => {
    const event = await getSportarrEvent(eventId);
    return event ? findJellyfinRecordingItemId(event) : null;
  });
}

export function checkedRecordingStream(res: Response, eventId: number): Response {
  if (res.status === 502) forgetItemId(recordingKey(eventId));
  return res;
}

export function streamEpisodeItemId(showId: string, season: number, episode: number): Promise<string | null> {
  return cachedItemId(episodeKey(showId, season, episode), () => findJellyfinEpisodeItemId(showId, season, episode));
}

export function streamMovieItemId(tmdbId: string): Promise<string | null> {
  return cachedItemId(movieKey(tmdbId), () => findJellyfinMovieItemId(tmdbId));
}

/** Passes the response through, forgetting the item if Jellyfin would not serve it. */
export function checkedEpisodeStream(res: Response, showId: string, season: number, episode: number): Response {
  if (res.status === 502) forgetItemId(episodeKey(showId, season, episode));
  return res;
}

export function checkedMovieStream(res: Response, tmdbId: string): Response {
  if (res.status === 502) forgetItemId(movieKey(tmdbId));
  return res;
}
