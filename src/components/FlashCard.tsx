"use client";

import { useState } from "react";
import Link from "next/link";
import type { FlashGameSummary } from "@/lib/flashGameRules";
import { FlashWatchlistButton } from "@/components/FlashWatchlistButton";

/**
 * One Flash game in a row, laid out like every other card on the site.
 *
 * The library rows used to render their own card: a grey box with the title
 * centred in it and the title repeated underneath, no art and no My List
 * button. Sitting directly above the archive rows, which did have all three,
 * it read as two different features rather than one -- so this is the single
 * card both now use.
 *
 * Artwork resolution, in order:
 *
 *  1. Flashpoint's logo, proxied through our own origin
 *  2. a title treatment, when there is no `flashpointId` or the archive has no
 *     art for it
 *
 * Step 2 is why this is a client component. A plain <img> with a src that 404s
 * renders the browser's broken-image glyph, which is what was showing on The
 * Impossible Quiz -- worse than no image at all, because it reads as a bug.
 * Falling back needs the error event, and the error event needs the browser.
 */
export function FlashCard({
  game,
  inList,
}: {
  game: FlashGameSummary;
  inList: boolean;
}) {
  // Games with no Flashpoint entry have no art to try for, so they start in
  // the fallback rather than requesting a URL that cannot resolve.
  const [artFailed, setArtFailed] = useState(!game.flashpointId);
  const showArt = !artFailed && game.flashpointId;

  return (
    <div className="w-40 shrink-0 sm:w-48">
      <Link
        href={`/games/flash/${game.slug}`}
        className="group relative block aspect-video w-full overflow-hidden rounded bg-netflix-dark/80 ring-1 ring-white/10 transition-all hover:ring-white/40"
      >
        {showArt ? (
          /* Plain <img>: proxied through our own origin, and next/image would
             want a configured remote pattern for a host we never link to. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/flash/art/${encodeURIComponent(game.flashpointId!)}`}
            alt=""
            loading="lazy"
            onError={() => setArtFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          // Deliberately not a generic placeholder icon: the title is the only
          // thing that distinguishes one of these from another, so a row of
          // art-less games stays readable instead of becoming identical tiles.
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-white/[0.07] to-transparent px-2">
            <span className="line-clamp-3 text-center text-xs font-semibold text-white/70">
              {game.title}
            </span>
          </div>
        )}

        {!game.playable && (
          // A row exists as soon as a game is bookmarked; the SWF arrives on
          // first play. Worth saying on the card, since the alternative is
          // finding out by clicking and waiting.
          <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] font-medium text-white/80">
            Not downloaded
          </span>
        )}

        {game.isActionScript3 && (
          // The difference between a game that runs and one that doesn't, and
          // finding out after clicking is worse.
          <span
            title="Uses ActionScript 3 — the Flash emulator supports it only partially"
            className="absolute right-1 top-1 rounded bg-amber-500/80 px-1 text-[10px] font-bold text-black"
          >
            AS3
          </span>
        )}

        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-4 text-left text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          Play
        </span>
      </Link>

      {/* Title, author and the My List toggle in the same places as the
          archive rows and the Movies/TV cards. */}
      <div className="mt-1 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-xs text-white/70">{game.title}</p>
          {game.developer && (
            <p className="truncate text-[11px] text-white/35">{game.developer}</p>
          )}
        </div>
        <div className="mt-0.5 shrink-0">
          <FlashWatchlistButton slug={game.slug} initialInList={inList} variant="circle" />
        </div>
      </div>
    </div>
  );
}
