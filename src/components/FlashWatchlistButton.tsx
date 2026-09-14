"use client";

import { useState } from "react";

type Props = {
  slug: string;
  initialInList: boolean;
  /** Icon-only, for the corner of a card. */
  variant?: "default" | "circle";
};

/**
 * My List toggle for a Flash game.
 *
 * Same shape as GameWatchlistButton, minus the title/platform snapshot: a
 * Flash game's catalogue row is local, so the list stores only the slug and
 * reads the rest back through the relation.
 */
export function FlashWatchlistButton({ slug, initialInList, variant = "default" }: Props) {
  const [inList, setInList] = useState(initialInList);
  const [loading, setLoading] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // These sit inside the card's own <Link>; without this, adding to a list
    // also navigates into the game.
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      const res = inList
        ? await fetch(`/api/games/flash-watchlist?slug=${encodeURIComponent(slug)}`, {
            method: "DELETE",
          })
        : await fetch("/api/games/flash-watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug }),
          });
      if (res.ok) setInList(!inList);
    } finally {
      setLoading(false);
    }
  }

  const label = inList ? "Remove from My List" : "Add to My List";

  if (variant === "circle") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        title={label}
        aria-label={label}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white ring-1 ring-white/30 transition-colors hover:bg-black/90 disabled:opacity-50"
      >
        {inList ? "✓" : "+"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className="rounded bg-white/10 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/20 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
