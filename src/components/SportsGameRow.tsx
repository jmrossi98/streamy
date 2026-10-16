"use client";

import { useState } from "react";
import { Badge, Button, ButtonLink } from "@/components/ui";
import { formatFileSize } from "@/lib/formatBytes";
import type { SportsGame } from "@/lib/sportarr";

/**
 * One finished game and what can be done about its recording.
 *
 * The control walks the same road as a movie's Request button -- ask,
 * downloading, available -- with one extra step in front: Sportarr never
 * looks for a release on its own, so "Check for recording" is the viewer
 * asking whether one exists at all. Checks are lazy (a click, not a page
 * load): each costs an indexer call per indexer and a few seconds, and a
 * night of hockey is sixteen games most of which nobody will want.
 */
export function SportsGameRow({ game, onChange }: { game: SportsGame; onChange: (game: SportsGame) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (method: "GET" | "POST", fresh = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports/games/${game.id}/recording${fresh ? "?fresh=1" : ""}`, { method });
      const data = (await res.json().catch(() => ({}))) as { game?: SportsGame; error?: string };
      if (!res.ok || !data.game) throw new Error(data.error || "Something went wrong");
      onChange(data.game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const score =
    game.homeScore != null && game.awayScore != null ? `${game.homeScore}–${game.awayScore}` : null;
  const detail = game.status === "live" ? "In progress" : game.status === "upcoming" ? "Upcoming" : `Final${score ? ` ${score}` : ""}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-white/5 px-3 py-2">
      <Badge tone="neutral" className="w-12 shrink-0 justify-center uppercase tracking-wide">
        {game.league}
      </Badge>
      {/* Full-width line of its own on a phone, where the badge, the score
          and the control leave no room for two team names. */}
      <p className="order-last w-full min-w-0 flex-1 truncate text-sm text-white/90 sm:order-none sm:w-auto" title={game.title}>
        {game.title}
      </p>
      <span className="shrink-0 text-xs text-white/50">{detail}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {error && <span className="text-xs text-red-300">{error}</span>}
        <StatusControl game={game} busy={busy} onCheck={(fresh) => call("GET", fresh)} onDownload={() => call("POST")} />
      </div>
    </li>
  );
}

function StatusControl({
  game, busy, onCheck, onDownload,
}: { game: SportsGame; busy: boolean; onCheck: (fresh: boolean) => void; onDownload: () => void }) {
  switch (game.status) {
    case "ready":
      return (
        <ButtonLink href={`/live/recordings/${game.id}`} variant="primary" size="sm">
          Watch
        </ButtonLink>
      );
    case "downloading": {
      const d = game.download;
      const label = d?.error
        ? "Download stalled"
        : d?.importing
          ? "Importing…"
          : `Downloading… ${d?.progress ?? 0}%`;
      return (
        <Badge tone={d?.error ? "warning" : "info"} title={d?.error ?? undefined}>
          {label}
        </Badge>
      );
    }
    case "recording-available": {
      const r = game.recording;
      const parts = [formatFileSize(r?.sizeBytes), r?.quality?.replace(/^.*-/, "")].filter(Boolean);
      return (
        <Button variant="primary" size="sm" disabled={busy} onClick={onDownload}>
          {busy ? "Starting…" : `Download${parts.length ? ` (${parts.join(" · ")})` : ""}`}
        </Button>
      );
    }
    case "no-recording":
      return (
        <>
          <Badge tone="neutral">No recording yet</Badge>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCheck(true)}>
            {busy ? "Checking…" : "Check again"}
          </Button>
        </>
      );
    case "finished":
      return (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onCheck(false)}>
          {busy ? "Checking…" : "Check for recording"}
        </Button>
      );
    default:
      return null;
  }
}
