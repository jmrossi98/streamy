"use client";

import { useRouter } from "next/navigation";

type Props = {
  /** Target show URL including `?season=` so the season list matches where the user played from. */
  fallbackHref: string;
  className?: string;
};

export function EpisodeCloseButton({ fallbackHref, className }: Props) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Always navigate to /show/[id]?season=N — router.back() often lands on /show/[id] without ?season= and resets the list to season 1.
    router.push(fallbackHref);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      aria-label="Close and return to show"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
