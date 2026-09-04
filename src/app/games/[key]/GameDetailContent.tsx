"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GameListItem } from "@/lib/games";
import type { ArtworkKind } from "@/lib/steamgriddb";
import { GameDownloadButton } from "@/components/GameDownloadButton";
import { GameWatchlistButton } from "@/components/GameWatchlistButton";
import { GameArtworkPicker } from "@/components/GameArtworkPicker";
import { formatFileSize } from "@/lib/formatBytes";

// Matches DownloadsPanel/GamesPanel's own cadence for a live-progressing
// download; there's nothing to gain from polling faster on a single-game page.
const REFRESH_INTERVAL_MS = 5000;

export function GameDetailContent({
  item,
  initialInWatchlist,
  savedArtworkKinds,
  savedArtwork,
}: {
  item: GameListItem;
  initialInWatchlist: boolean;
  savedArtworkKinds: string[];
  savedArtwork: Partial<Record<string, string>>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const validKinds: ArtworkKind[] = ["grid", "hero", "logo", "icon"];
  const savedKinds = savedArtworkKinds.filter((k): k is ArtworkKind =>
    (validKinds as string[]).includes(k)
  );

  // Local copy of the four artwork kinds so picking new art -- cover,
  // banner, logo, or icon -- shows up immediately (main poster included)
  // instead of waiting for a full page reload to re-read the saved rows.
  const [artwork, setArtwork] = useState<Partial<Record<ArtworkKind, string>>>(() => {
    const initial: Partial<Record<ArtworkKind, string>> = { grid: item.posterUrl ?? undefined };
    for (const k of savedKinds) {
      const url = savedArtwork[k];
      if (url) initial[k] = url;
    }
    return initial;
  });

  // Auto-refresh while this game is actively moving through gamarr's
  // pipeline, so progress/status update without a manual reload -- same
  // "poll unconditionally while relevant" idiom DownloadsPanel uses. Once it
  // reaches "library" (or sits failed/queued), nothing is changing on its
  // own and polling would just be wasted requests.
  useEffect(() => {
    if (item.status !== "downloading") return;
    const t = setInterval(() => {
      if (!refreshing) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [item.status, router, refreshing]);

  const sizeText = formatFileSize(item.sizeBytes);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-24 sm:px-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <div className="relative aspect-[2/3] w-40 shrink-0 overflow-hidden rounded bg-white/5 sm:w-56">
          {artwork.grid ? (
            <Image src={artwork.grid} alt={item.displayTitle} fill className="object-cover" unoptimized priority />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg className="h-10 w-10 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M6 12h4m-2-2v4m7-3h.01M17 13h.01M9 18h6a3 3 0 003-3v-2a5 5 0 00-5-5H8a5 5 0 00-5 5v2a3 3 0 003 3z"
                />
              </svg>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">{item.displayTitle}</h1>
            <p className="mt-1 text-white/50">
              {item.platform}
              {sizeText ? ` · ${sizeText}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <GameDownloadButton
              title={item.displayTitle}
              platform={item.platform}
              platformSlug={item.platformSlug}
              status={item.status}
              progress={item.progress}
              error={item.error}
              wishlistId={item.wishlistId}
              jobId={item.jobId}
              sizeText={sizeText}
              onChanged={() => startRefresh(() => router.refresh())}
            />
            <GameWatchlistButton
              gameKey={item.gameKey}
              title={item.displayTitle}
              platform={item.platform}
              initialInList={initialInWatchlist}
            />
          </div>
        </div>
      </div>

      <div className="mt-10 border-t border-white/10 pt-8">
        <h2 className="mb-1 text-lg font-semibold text-white">Artwork</h2>
        {item.system && item.romStem ? (
          <>
            <p className="mb-4 text-sm text-white/50">
              Pick real cover art from SteamGridDB. Choosing here updates this game&apos;s poster in
              Streamy immediately, and reaches the Steam Deck the next time it checks in.
            </p>

            {/* Live layout preview -- banner behind, logo over it, cover
                overlapping bottom-left, icon badged bottom-right, roughly
                matching how Steam's own Big Picture library card is built
                out of these same four asset kinds. Updates the instant a
                pick is saved below, no reload needed. */}
            <div className="relative mb-6 aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-white/10 bg-white/5">
              {artwork.hero ? (
                <Image src={artwork.hero} alt="" fill unoptimized className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-white/25">
                  No banner picked yet
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              {artwork.logo && (
                <Image
                  src={artwork.logo}
                  alt=""
                  width={200}
                  height={80}
                  unoptimized
                  className="absolute bottom-4 right-4 max-h-16 w-auto object-contain drop-shadow"
                />
              )}
              <div className="absolute bottom-3 left-3 flex items-end gap-2">
                <div className="relative aspect-[2/3] w-16 shrink-0 overflow-hidden rounded border border-white/20 bg-black/40 shadow-lg">
                  {artwork.grid ? (
                    <Image src={artwork.grid} alt="" fill unoptimized className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-white/30">
                      No cover
                    </div>
                  )}
                </div>
                {artwork.icon && (
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded border border-white/20 bg-black/40 shadow-lg">
                    <Image src={artwork.icon} alt="" fill unoptimized className="object-cover" />
                  </div>
                )}
              </div>
            </div>

            <GameArtworkPicker
              system={item.system}
              romStem={item.romStem}
              savedKinds={savedKinds}
              initialArtwork={artwork}
              onArtworkSaved={(kind, url) =>
                setArtwork((prev) => ({ ...prev, [kind]: url ?? undefined }))
              }
            />
          </>
        ) : (
          <p className="text-sm text-white/50">
            Available once this game finishes downloading — there&apos;s no file to attach artwork to yet.
          </p>
        )}
      </div>
    </div>
  );
}
