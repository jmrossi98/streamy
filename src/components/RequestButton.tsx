"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOutIfStaleSession } from "@/lib/staleSession";

// Actively downloading: refresh often enough that the percentage visibly
// climbs. Queued/searching: nothing moves second-to-second, so back off.
const POLL_INTERVAL_DOWNLOADING_MS = 5000;
const POLL_INTERVAL_QUEUED_MS = 15000;

export type RequestButtonProps = {
  movieId?: string;
  showId?: string;
  /** Server-computed initial status ("requested" | "downloading" | "available" | null). */
  initialStatus: string | null;
  /** Server-computed initial download percent (0-100), only meaningful while downloading. */
  initialProgress?: number | null;
};

const PRIMARY_CLASS =
  "inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-sm font-bold uppercase tracking-[0.14em] text-netflix-black shadow-lg hover:bg-white/90 active:bg-white/85 touch-manipulation disabled:opacity-50 disabled:pointer-events-none md:w-auto md:min-h-[44px] md:rounded md:px-6 md:py-3 md:text-base md:font-semibold md:normal-case md:tracking-normal md:shadow-none";

const BADGE_CLASS =
  "inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 py-4 text-sm font-semibold uppercase tracking-wide text-white/90 md:w-auto md:min-h-[44px] md:rounded md:px-6 md:py-3 md:text-base md:normal-case md:tracking-normal";

const BADGE_CLICKABLE_CLASS = `${BADGE_CLASS} hover:bg-white/20 transition-colors touch-manipulation`;

const DOWNLOADING_BADGE_CLASS =
  "flex w-full flex-col gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 py-4 text-white/90 md:w-auto md:min-w-[220px] md:rounded md:px-6 md:py-3";

export function RequestButton({ movieId, showId, initialStatus, initialProgress = null }: RequestButtonProps) {
  const id = movieId ?? showId ?? "";
  const mediaType = movieId ? "movie" : "show";
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [status, setStatus] = useState<string | null>(initialStatus);
  const [progress, setProgress] = useState<number | null>(initialProgress);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [managing, setManaging] = useState<"cancel" | "delete" | null>(null);
  const refreshedRef = useRef(false);
  // setLoading(true) doesn't disable the button until the next render commits,
  // leaving a window where a fast double-click fires two concurrent POSTs
  // (both then race Radarr/Sonarr's own duplicate-add check). This ref is
  // checked/set synchronously in the click handler, so it closes that window.
  const inFlightRef = useRef(false);

  const callbackUrl = mediaType === "movie" ? `/watch/${id}` : `/show/${id}`;

  const request = useCallback(async () => {
    if (!session?.user || inFlightRef.current || !id) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(false);
    // Show the queued state immediately. The POST behind it does a
    // Radarr/Sonarr lookup plus a search and can take seconds; leaving the
    // button idle that whole time reads as an unregistered click and invites
    // a second one. Rolled back below if the request actually fails.
    setStatus("requested");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: id, mediaType }),
      });
      if (await signOutIfStaleSession(res)) return;
      if (!res.ok) {
        setStatus(null);
        setError(true);
        return;
      }
      const data = await res.json();
      setStatus(data.status ?? "requested");
    } catch {
      setStatus(null);
      setError(true);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [session?.user, id, mediaType]);

  // Any signed-in user can cancel an in-progress download or delete a
  // finished one, right from the title page -- so a stuck or unwanted
  // download never has to wait on the admin to step in.
  const manage = useCallback(
    async (action: "cancel" | "delete") => {
      if (!session?.user || managing) return;
      // Cancel goes through without a prompt -- it only stops an in-flight
      // download and can simply be started again. Delete removes files
      // already on disk, so that one still confirms.
      if (action === "delete" && !window.confirm("Delete the downloaded file for this title?")) {
        return;
      }
      setManaging(action);
      setError(false);
      try {
        const res = await fetch("/api/requests/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId: id, mediaType, action }),
        });
        if (await signOutIfStaleSession(res)) return;
        if (!res.ok) {
          setError(true);
          return;
        }
        setStatus(null);
        setProgress(null);
        router.refresh();
      } catch {
        setError(true);
      } finally {
        setManaging(null);
      }
    },
    [session?.user, managing, id, mediaType, router]
  );

  // Poll our own status endpoint while a request is in flight — Radarr/Sonarr
  // update it server-side via webhook, this just picks the change (and live
  // download progress) up. Shared/global status, so this also picks up
  // downloads started by a different user.
  useEffect(() => {
    if (status !== "requested" && status !== "downloading") return;
    const intervalMs =
      status === "downloading" ? POLL_INTERVAL_DOWNLOADING_MS : POLL_INTERVAL_QUEUED_MS;
    const interval = setInterval(() => {
      fetch(`/api/requests/check?tmdbId=${encodeURIComponent(id)}&mediaType=${mediaType}`)
        .then((r) => r.json())
        .then((data) => {
          // A cleared row (cancelled, or auto-healed and re-searching) comes
          // back as null -- reset rather than freezing on the old status.
          setStatus(data.status ?? null);
          setProgress(typeof data.progress === "number" ? data.progress : null);
        })
        .catch(() => {});
    }, intervalMs);
    return () => clearInterval(interval);
  }, [status, id, mediaType]);

  // Once available, ask the parent server component to re-check video
  // availability — if it's synced already, this component unmounts in favor
  // of the real Play button.
  useEffect(() => {
    if (status === "available" && !refreshedRef.current) {
      refreshedRef.current = true;
      router.refresh();
    }
  }, [status, router]);

  // Status is shared/global library state — show it to anyone viewing the
  // page, logged in or not. Only the idle "nothing requested yet" case needs
  // to branch on auth (sign-in prompt vs. an actual clickable Download button).
  if (status === "requested" || status === "downloading") {
    return (
      <div className={DOWNLOADING_BADGE_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide md:text-base md:normal-case md:tracking-normal">
            <span className="h-4 w-4 shrink-0 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            {status === "downloading"
              ? `Downloading${typeof progress === "number" ? ` — ${progress}%` : "…"}`
              : "Queued — searching…"}
          </span>
          {authStatus === "authenticated" && (
            <button
              type="button"
              onClick={() => manage("cancel")}
              disabled={managing === "cancel"}
              className="shrink-0 text-xs font-medium normal-case tracking-normal text-white/50 hover:text-netflix-red disabled:opacity-50"
            >
              {managing === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </div>
        {status === "downloading" && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-netflix-red transition-[width] duration-500"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
        )}
        {error && <p className="text-xs normal-case tracking-normal text-netflix-red">Couldn&apos;t cancel — try again</p>}
      </div>
    );
  }

  if (status === "available") {
    return (
      <div className={DOWNLOADING_BADGE_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-sm font-semibold uppercase tracking-wide md:text-base md:normal-case md:tracking-normal hover:text-white"
          >
            Downloaded — tap to refresh
          </button>
          {authStatus === "authenticated" && (
            <button
              type="button"
              onClick={() => manage("delete")}
              disabled={managing === "delete"}
              className="shrink-0 text-xs font-medium normal-case tracking-normal text-white/50 hover:text-netflix-red disabled:opacity-50"
            >
              {managing === "delete" ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
        {error && <p className="text-xs normal-case tracking-normal text-netflix-red">Couldn&apos;t delete — try again</p>}
      </div>
    );
  }

  if (authStatus !== "authenticated") {
    return (
      <Link href={`/who-is-watching?callbackUrl=${encodeURIComponent(callbackUrl)}`} className={PRIMARY_CLASS}>
        <DownloadIcon />
        Download
      </Link>
    );
  }

  return (
    <button type="button" onClick={request} disabled={loading} className={PRIMARY_CLASS}>
      {loading ? (
        <span className="h-5 w-5 shrink-0 rounded-full border-2 border-netflix-black/30 border-t-netflix-black animate-spin" />
      ) : (
        <DownloadIcon />
      )}
      {error ? "Couldn't download — try again" : "Download"}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
    </svg>
  );
}
