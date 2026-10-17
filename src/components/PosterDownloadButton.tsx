"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { lookupRequestStatus, rememberRequestStatus } from "@/lib/requestStatusBatch";
import { tileDownloadState } from "@/lib/posterDownloadRules";
import { signOutIfStaleSession } from "@/lib/staleSession";
import { PosterIconButton } from "@/components/ui";

type Props = { movieId?: string; showId?: string };

/**
 * Admin-only: start a download straight from a poster tile, next to the My
 * List button, without opening the title. Same request as the title page's
 * Download button (a show pulls the whole series). Hidden once downloaded.
 */
export function PosterDownloadButton({ movieId, showId }: Props) {
  const { data: session } = useSession();
  const isAdmin = !!session?.user?.isAdmin;
  const id = movieId ?? showId ?? "";
  const mediaType = movieId ? "movie" : "show";
  const [status, setStatus] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isAdmin || !id) return;
    let live = true;
    lookupRequestStatus(mediaType, id, (s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [isAdmin, id, mediaType]);

  if (!isAdmin || !id) return null;
  const state = tileDownloadState(status);
  if (state === "hidden") return null;

  async function start(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inFlight.current || state !== "idle") return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: id, mediaType }),
      });
      if (await signOutIfStaleSession(res)) return;
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()).status ?? "requested";
      rememberRequestStatus(mediaType, id, next);
      setStatus(next);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const label = error
    ? "Download failed, click to retry"
    : state === "queued"
      ? "Download queued"
      : state === "downloading"
        ? "Downloading"
        : mediaType === "show"
          ? "Download series"
          : "Download";

  return (
    <PosterIconButton
      onClick={start}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`${error ? "!border-netflix-red" : ""} ${state !== "idle" && !error ? "cursor-default" : ""}`}
    >
      {busy || state === "downloading" ? (
        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      ) : state === "queued" && !error ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </PosterIconButton>
  );
}
