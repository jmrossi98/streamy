"use client";

import { useRouter } from "next/navigation";

type Props = {
  showId: string;
  seasonNum: number;
  /** Fallback when history is empty (e.g. opened in new tab). */
  fallbackHref: string;
  className?: string;
};

export function EpisodeCloseButton({ showId, seasonNum, fallbackHref, className }: Props) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
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
