"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FlashpointGame } from "@/lib/flashpoint";

/**
 * The little a card actually needs.
 *
 * Search hands over a whole FlashpointGame, because the browser already has
 * one. The generated catalogue stores three fields per game across thousands
 * of entries, so it hands over only this -- and the server fills in the rest
 * from the id when someone opens the game.
 */
export type CardGame = {
  /** Flashpoint id, or null when only Andkon has this game. */
  id?: string | null;
  /** Andkon's "category/slug", when it came from the catalogue. */
  andkonPath?: string;
  title: string;
  developer: string;
};

/**
 * One archive game, with the two things that were missing: a way in, and a way
 * to add it.
 *
 * Both go through the same endpoint, because both need the game to exist
 * locally first -- a list entry has to point at a row, and a detail page has
 * to have one to render. Neither downloads the SWF; that happens on the detail
 * page when someone actually wants to play. Recording a game and fetching it
 * are separate on purpose, so bookmarking from a 180,000-entry archive stays
 * free.
 */
export function BrowseCard({
  game,
  owned,
  full,
}: {
  game: CardGame;
  owned: boolean;
  /**
   * The complete archive entry, when the caller has one. Sent as-is so a
   * search result doesn't need a second lookup; without it the server
   * resolves the id itself.
   */
  full?: FlashpointGame;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"open" | "list" | null>(null);
  const [listed, setListed] = useState(owned);
  const [artFailed, setArtFailed] = useState(false);

  async function ensureLocal(): Promise<string | null> {
    const res = await fetch("/api/flash/known", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The Andkon path goes along even when Flashpoint has the game: it is
      // the fallback the importer needs if every build in the GameZIP turns
      // out to be domain-locked.
      body: JSON.stringify(
        full
          ? { game: full }
          : { id: game.id ?? undefined, andkon: game.andkonPath, title: game.title }
      ),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { slug?: string };
    return data.slug ?? null;
  }

  async function open() {
    if (busy) return;
    setBusy("open");
    const slug = await ensureLocal();
    if (slug) router.push(`/games/flash/${slug}`);
    else setBusy(null);
  }

  async function addToList(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy("list");
    try {
      const slug = await ensureLocal();
      if (!slug) return;
      const res = await fetch("/api/games/flash-watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (res.ok) {
        setListed(true);
        // The My List shelf is server-rendered, so it only picks this up on a
        // re-render -- otherwise the game is on the list but the row above
        // doesn't show it until the page is reloaded.
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-40 shrink-0 sm:w-48">
      <button
        type="button"
        onClick={open}
        disabled={busy !== null}
        className="group relative block aspect-video w-full overflow-hidden rounded bg-black/40 ring-1 ring-white/10 transition-all hover:ring-white/40 disabled:opacity-60"
      >
        {artFailed ? (
          // Plenty of archive entries simply have no logo. A plain <img> whose
          // src 404s renders the browser's broken-image glyph, which reads as a
          // bug rather than as missing art -- so fall back to the title, which
          // is the only thing that tells one of these apart from another.
          <span className="flex h-full items-center justify-center bg-gradient-to-br from-white/[0.07] to-transparent px-2 text-center text-xs font-semibold text-white/70">
            <span className="line-clamp-3">{game.title}</span>
          </span>
        ) : (
          /* Plain <img>: proxied through our own origin, and next/image would
             want a configured remote pattern for a host we never link directly. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            // One endpoint, which tries Flashpoint's logo, then its
            // screenshot, then Andkon's icon before giving up.
            src={
              `/api/flash/art/${encodeURIComponent(game.id ?? "none")}` +
              (game.andkonPath
                ? `?andkon=${encodeURIComponent(game.andkonPath.split("/")[1] ?? "")}`
                : "")
            }
            alt=""
            loading="lazy"
            onError={() => setArtFailed(true)}
            className="h-full w-full object-cover"
          />
        )}
        {busy === "open" && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
            Opening…
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-4 text-left text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          Play
        </span>
      </button>

      <div className="mt-1 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-xs text-white/70">{game.title}</p>
          {game.developer && (
            <p className="truncate text-[11px] text-white/35">{game.developer}</p>
          )}
        </div>
        <button
          type="button"
          onClick={addToList}
          disabled={busy !== null || listed}
          title={listed ? "In My List" : "Add to My List"}
          aria-label={listed ? "In My List" : "Add to My List"}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white transition-colors hover:bg-white/25 disabled:opacity-60"
        >
          {listed ? "✓" : "+"}
        </button>
      </div>
    </div>
  );
}
