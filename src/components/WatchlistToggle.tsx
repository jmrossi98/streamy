"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutIfStaleSession } from "@/lib/staleSession";
import {
  watchlistAddRequest,
  watchlistRemoveRequest,
  type WatchlistKind,
} from "@/lib/watchlistKinds";

/**
 * One My List toggle, for every kind of thing that can be saved.
 *
 * Replaces GameWatchlistButton, FlashWatchlistButton and ChannelWatchlistButton,
 * which were the same component three times with three different sets of bugs.
 * See lib/watchlistKinds.ts for what had drifted apart between them.
 *
 * The behaviour here is the best of the three, applied to all of them:
 *
 *  - The flip happens before the request, not after. Only two of the five did
 *    this, and FlashWatchlistButton's comment says exactly why: waiting on a
 *    round trip to show the change "made adding a game feel broken enough to
 *    tap twice". The button is the acknowledgement that the tap landed.
 *  - Failure reverts it, so optimism never turns into a lie.
 *  - router.refresh() after a success, because the My List shelf is rendered
 *    on the server and otherwise does not follow until someone reloads.
 *  - Stale sessions are handled on every kind, not two of five.
 *  - One label per state, so the same thing is not called "In My List" here and
 *    "Remove from My List" there.
 */

export type WatchlistToggleVariant = "pill" | "button" | "hero" | "badge";

const CheckIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

const PlusIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

export function WatchlistToggle({
  kind,
  itemId,
  initialInList,
  extra,
  variant = "pill",
  className = "",
}: {
  kind: WatchlistKind;
  itemId: string;
  initialInList: boolean;
  /** Snapshot fields some kinds persist alongside the id -- see watchlistKinds.ts. */
  extra?: Record<string, string>;
  variant?: WatchlistToggleVariant;
  className?: string;
}) {
  const router = useRouter();
  const [inList, setInList] = useState(initialInList);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // Several of these render inside a card's own <Link>. Without this, saving
    // something also navigates into it -- which was handled in three of the
    // five components and forgotten in the other two.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    const next = !inList;
    setInList(next);
    setBusy(true);
    try {
      const [url, init] = next
        ? watchlistAddRequest(kind, itemId, extra)
        : watchlistRemoveRequest(kind, itemId);
      const res = await fetch(url, init);

      if (await signOutIfStaleSession(res)) return;
      if (!res.ok) {
        setInList(!next);
        return;
      }
      router.refresh();
    } catch {
      setInList(!next);
    } finally {
      setBusy(false);
    }
  }

  const label = inList ? "Remove from My List" : "Add to My List";
  const common = "transition-colors disabled:opacity-50";

  if (variant === "badge") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={label}
        aria-label={label}
        className={`flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white ring-1 ring-white/30 hover:bg-black/90 ${common} ${className}`}
      >
        {inList ? "✓" : "+"}
      </button>
    );
  }

  if (variant === "hero") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={label}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white hover:bg-white/30 ${common} ${className}`}
      >
        {busy ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : inList ? (
          <CheckIcon className="h-6 w-6" />
        ) : (
          <PlusIcon className="h-6 w-6" />
        )}
      </button>
    );
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={label}
        className={`inline-flex min-h-[44px] min-w-[140px] items-center justify-center gap-2 rounded border border-white/40 bg-white/20 px-6 py-3 font-semibold text-white hover:bg-white/30 sm:min-w-[160px] ${common} ${className}`}
      >
        {inList ? <CheckIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={label}
      className={`rounded bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 ${common} ${className}`}
    >
      {label}
    </button>
  );
}
