"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Prefetch a tile's page when the pointer first reaches it, and only then.
 *
 * Tile links are `prefetch={false}`: a viewport prefetch made the server
 * fully render the title page of every tile on screen -- each with its own
 * Jellyfin and Radarr lookups -- whether or not anyone was going to open it
 * (31 different title pages timing out in ten quiet minutes, 2026-10-17).
 * Hover is a real signal of intent, and a tile is prefetched at most once
 * however many times the pointer crosses it.
 */
export function useHoverPrefetch(hrefs: string[], warm?: () => void): () => void {
  const router = useRouter();
  const done = useRef(false);
  return () => {
    if (done.current) return;
    done.current = true;
    for (const href of hrefs) router.prefetch(href);
    warm?.();
  };
}
