"use client";

import { EpisodePlayer } from "@/components/EpisodePlayer";

export function EpisodeHarness() {
  return (
    <EpisodePlayer
      showId="harness"
      showName="Episode Harness"
      seasonNumber={1}
      episodeNumber={1}
      episodeName="Pilot"
      backdropUrl="https://placehold.co/1920x1080/1a1a1a/444?text=No+Backdrop"
      initialProgressSeconds={0}
      runtimeMinutes={null}
      autoPlay={false}
      nextEpisodeHref="/show/harness/episode/1/2"
      nextEpisodeLabel="S1 E2 · Second"
      videoUrl="/test-assets/pause-test-clip.mp4"
      // Inside the 4-second clip: an intro to skip, then credits.
      segments={{ intro: { start: 0, end: 2.5 }, recap: null, credits: { start: 3, end: 4 } }}
    />
  );
}
