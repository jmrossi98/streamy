"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-netflix-black flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-white mb-2">Something went wrong</h1>
      <p className="text-white/80 text-sm max-w-md mb-4">
        A server error occurred. Check the server logs (e.g. <code className="bg-white/10 px-1 rounded">docker logs</code>) for details.
      </p>
      <p className="text-white/60 text-xs max-w-md mb-6">
        Common causes: database not migrated (set <code className="bg-white/10 px-1 rounded">RUN_MIGRATE=1</code> in server .env and restart), wrong <code className="bg-white/10 px-1 rounded">NEXTAUTH_URL</code> or <code className="bg-white/10 px-1 rounded">DATABASE_URL</code>, or missing <code className="bg-white/10 px-1 rounded">TMDB_API_KEY</code>.
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 bg-white text-netflix-black font-medium rounded hover:bg-white/90"
      >
        Try again
      </button>
    </div>
  );
}
