import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { EpisodePlayer } from "@/components/EpisodePlayer";
import { getEpisodePlayback } from "@/lib/episodePlayback";

type Props = {
  params: Promise<{ id: string; season: string; episode: string }>;
};

export default async function EpisodeWatchPage({ params }: Props) {
  const { id: showId, season: seasonParam, episode: episodeParam } = await params;
  const seasonNum = parseInt(seasonParam, 10);
  const episodeNum = parseInt(episodeParam, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) notFound();

  const session = await getSession();
  const found = await getEpisodePlayback(showId, seasonNum, episodeNum, {
    userId: session?.user?.id ?? null,
    userAgent: (await headers()).get("user-agent"),
  });
  if (!found) notFound();
  const { show, playback } = found;

  return (
    <div className="min-h-screen bg-netflix-black relative">
      <EpisodePlayer
        showId={show.id}
        showName={show.name}
        backdropUrl={show.backdrop}
        seasonNumber={playback.seasonNumber}
        episodeNumber={playback.episodeNumber}
        episodeName={playback.episodeName}
        initialProgressSeconds={playback.progressSeconds}
        runtimeMinutes={playback.runtimeMinutes}
        autoPlay
        nextEpisodeHref={playback.next?.href ?? null}
        nextEpisodeLabel={playback.next?.label}
        videoUrl={playback.videoUrl}
        closeHref={`/show/${showId}?season=${seasonNum}`}
        subtitleTracks={playback.subtitleTracks}
        forceTranscode={playback.forceTranscode}
        defaultSubtitle={playback.defaultSubtitle}
        audioTracks={playback.audioTracks}
        defaultAudio={playback.defaultAudio}
        segments={playback.segments}
      />
    </div>
  );
}
