"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlayButtonToPlayPage({ movieId }: { movieId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setLoading(true);
    router.push(`/watch/${movieId}/play`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center text-netflix-black hover:bg-white hover:scale-105 transition-all shadow-xl disabled:pointer-events-none disabled:opacity-90"
      aria-label="Play"
    >
      {loading ? (
        <span
          className="w-10 h-10 rounded-full border-2 border-netflix-black/30 border-t-netflix-black animate-spin"
          aria-hidden
        />
      ) : (
        <svg
          className="w-10 h-10 flex items-center justify-center"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  );
}
