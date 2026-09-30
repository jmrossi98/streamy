/**
 * The episode after this one, for the player's next button and autoplay.
 * Pure, and shared by every way into the player -- the show page's Play
 * button, a row click, and the standalone episode page -- which used to each
 * compute it their own way (the Play button not at all, a row click not across
 * a season boundary).
 */
type Ep = { episodeNumber: number; name?: string };

export type NextEpisode = { seasonNumber: number; episodeNumber: number; href: string; label: string };

export function nextEpisode(
  showId: string,
  seasonNumber: number,
  episodeNumber: number,
  seasonEpisodes: Ep[],
  opts: { numberOfSeasons: number; nextSeasonEpisodes?: Ep[] | null }
): NextEpisode | null {
  const make = (s: number, e: Ep | number): NextEpisode => {
    const n = typeof e === "number" ? e : e.episodeNumber;
    const name = typeof e === "number" ? undefined : e.name;
    return {
      seasonNumber: s,
      episodeNumber: n,
      href: `/show/${showId}/episode/${s}/${n}`,
      label: name ? `S${s} E${n} · ${name}` : `S${s} E${n}`,
    };
  };
  const index = seasonEpisodes.findIndex((e) => e.episodeNumber === episodeNumber);
  if (index >= 0 && index < seasonEpisodes.length - 1) return make(seasonNumber, seasonEpisodes[index + 1]);
  // Specials don't roll into season 1, and the last season has nowhere to go.
  if (seasonNumber < 1 || seasonNumber >= opts.numberOfSeasons) return null;
  const first = opts.nextSeasonEpisodes?.[0];
  return make(seasonNumber + 1, first ?? 1);
}
