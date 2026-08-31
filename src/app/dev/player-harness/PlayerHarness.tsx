"use client";

import { WatchPlayer } from "@/components/WatchPlayer";

export function PlayerHarness({
  progressSeconds,
  autoPlay,
}: {
  progressSeconds: number;
  autoPlay: boolean;
}) {
  return (
    <WatchPlayer
      movieId="player-harness-test"
      movieTitle="Player Harness Test Clip"
      // Same fallback used elsewhere when a real title has no backdrop
      // (WatchPageContent.tsx) -- a real image next/image can optimize,
      // unlike pointing this at the mp4 test clip itself.
      backdropUrl="https://placehold.co/1920x1080/1a1a1a/444?text=No+Backdrop"
      initialProgressSeconds={progressSeconds}
      runtimeMinutes={1}
      autoPlay={autoPlay}
      videoUrl="/test-assets/pause-test-clip.mp4"
    />
  );
}
