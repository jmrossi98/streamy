"use client";

import { useState } from "react";
import Link from "next/link";
import { FlashDeleteButton } from "@/components/FlashDeleteButton";
import { formatFileSize } from "@/lib/formatBytes";

export type FlashDownloadRow = {
  slug: string;
  title: string;
  fileSize: number;
  storage: string | null;
};

/**
 * Every Flash game with a file on disk, and a way to throw each one away.
 *
 * The list exists because a bad download is invisible until someone opens the
 * game: a domain-locked build, a regional rip in the wrong language, a loader
 * stub picked over the game itself. All three have happened, and the only fix
 * used to be editing the database by hand over SSH.
 *
 * Deleting keeps the catalogue row -- My List entries and saved games point at
 * it -- and the file comes back on the next play.
 */
export function FlashDownloadsPanel({ rows }: { rows: FlashDownloadRow[] }) {
  const [games, setGames] = useState(rows);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = q ? games.filter((g) => g.title.toLowerCase().includes(q)) : games;
  const total = games.reduce((n, g) => n + g.fileSize, 0);

  if (games.length === 0) {
    return (
      <p className="text-sm text-white/40">
        No Flash games are downloaded yet. They arrive the first time someone plays one.
      </p>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder-white/30 focus:border-white/40 focus:outline-none sm:max-w-xs sm:text-sm"
        />
        <span className="text-sm text-white/40">
          {shown.length === games.length
            ? `${games.length} downloaded`
            : `${shown.length} of ${games.length}`}
          {" · "}
          {formatFileSize(total) ?? "0 MB"}
        </span>
      </div>

      {/* Scroll box, matching the other long lists on this page. */}
      <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {shown.map((g) => (
          <li
            key={g.slug}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1.5 text-sm odd:bg-white/[0.03]"
          >
            <Link
              href={`/games/flash/${g.slug}`}
              className="min-w-0 flex-1 truncate text-white/80 transition-colors hover:text-white"
            >
              {g.title}
            </Link>
            <span className="shrink-0 tabular-nums text-xs text-white/40">
              {formatFileSize(g.fileSize) ?? "—"}
            </span>
            {g.storage === "mediabox" && (
              // Worth showing: that copy lives on the read-only share, so
              // deleting only detaches the row from it.
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/50">
                mediabox
              </span>
            )}
            <FlashDeleteButton
              slug={g.slug}
              onDeleted={() => setGames((prev) => prev.filter((x) => x.slug !== g.slug))}
            />
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="py-6 text-center text-sm text-white/40">Nothing matches “{query}”.</p>
      )}
    </>
  );
}
