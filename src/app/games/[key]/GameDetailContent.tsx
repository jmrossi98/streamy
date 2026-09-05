"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GameListItem } from "@/lib/games";
import type { ArtworkKind } from "@/lib/steamgriddb";
import { GameDownloadButton } from "@/components/GameDownloadButton";
import { GameWatchlistButton } from "@/components/GameWatchlistButton";
import { GameArtworkPicker } from "@/components/GameArtworkPicker";
import { formatFileSize } from "@/lib/formatBytes";

// Matches DownloadsPanel/GamesPanel's own cadence for a live-progressing
// download; there's nothing to gain from polling faster on a single-game page.
const REFRESH_INTERVAL_MS = 5000;

export function GameDetailContent({
  item,
  initialInWatchlist,
  savedArtworkKinds,
  savedArtwork,
}: {
  item: GameListItem;
  initialInWatchlist: boolean;
  savedArtworkKinds: string[];
  savedArtwork: Partial<Record<string, string>>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const validKinds: ArtworkKind[] = ["grid", "hero", "logo", "icon"];
  const savedKinds = savedArtworkKinds.filter((k): k is ArtworkKind =>
    (validKinds as string[]).includes(k)
  );

  // Local copy of the four artwork kinds so picking new art -- cover,
  // banner, logo, or icon -- shows up immediately (main poster included)
  // instead of waiting for a full page reload to re-read the saved rows.
  const [artwork, setArtwork] = useState<Partial<Record<ArtworkKind, string>>>(() => {
    const initial: Partial<Record<ArtworkKind, string>> = { grid: item.posterUrl ?? undefined };
    for (const k of savedKinds) {
      const url = savedArtwork[k];
      if (url) initial[k] = url;
    }
    return initial;
  });

  // Auto-refresh while this game is actively moving through gamarr's
  // pipeline, so progress/status update without a manual reload -- same
  // "poll unconditionally while relevant" idiom DownloadsPanel uses. Once it
  // reaches "library" (or sits failed/queued), nothing is changing on its
  // own and polling would just be wasted requests.
  useEffect(() => {
    if (item.status !== "downloading") return;
    const t = setInterval(() => {
      if (!refreshing) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [item.status, router, refreshing]);

  const sizeText = formatFileSize(item.sizeBytes);

  // Local override so a title edit shows immediately, same pattern as
  // `artwork` above -- only meaningful once system/romStem exist (a real
  // file on disk), same gate the artwork picker uses.
  const [displayTitle, setDisplayTitle] = useState(item.displayTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.displayTitle);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  async function saveTitle(title: string) {
    if (!item.system || !item.romStem) return;
    setSavingTitle(true);
    setTitleError(null);
    try {
      const res = await fetch("/api/admin/games/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: item.system, romStem: item.romStem, title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTitleError(data?.error ?? "Couldn't save that title");
        return;
      }
      if (title) {
        setDisplayTitle(title);
        setEditingTitle(false);
      } else {
        // Cleared -- there's no client-side way to know what romSearchTitle
        // would derive on its own without duplicating that logic here, so
        // let the server figure it out fresh.
        startRefresh(() => router.refresh());
        setEditingTitle(false);
      }
    } catch {
      setTitleError("Couldn't save that title.");
    } finally {
      setSavingTitle(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-24 sm:px-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <div className="relative aspect-[2/3] w-40 shrink-0 overflow-hidden rounded bg-white/5 sm:w-56">
          {artwork.grid ? (
            <Image src={artwork.grid} alt={displayTitle} fill className="object-cover" unoptimized priority />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg className="h-10 w-10 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M6 12h4m-2-2v4m7-3h.01M17 13h.01M9 18h6a3 3 0 003-3v-2a5 5 0 00-5-5H8a5 5 0 00-5 5v2a3 3 0 003 3z"
                />
              </svg>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div>
            {editingTitle ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle(titleDraft.trim());
                    if (e.key === "Escape") {
                      setTitleDraft(displayTitle);
                      setEditingTitle(false);
                    }
                  }}
                  autoFocus
                  placeholder="Title"
                  className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-1.5 font-display text-xl font-bold text-white focus:border-white/30 focus:outline-none sm:text-2xl"
                />
                <button
                  type="button"
                  onClick={() => saveTitle(titleDraft.trim())}
                  disabled={savingTitle || !titleDraft.trim()}
                  className="rounded bg-netflix-red px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {savingTitle ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(displayTitle);
                    setEditingTitle(false);
                  }}
                  disabled={savingTitle}
                  className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/70 hover:border-white/40 hover:text-white disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveTitle("")}
                  disabled={savingTitle}
                  className="text-xs text-white/40 underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
                >
                  Reset to default
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">{displayTitle}</h1>
                {item.system && item.romStem && (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(displayTitle);
                      setEditingTitle(true);
                    }}
                    title="Edit title"
                    className="text-white/30 hover:text-white"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {titleError && <p className="mt-1 text-xs text-red-400">{titleError}</p>}
            <p className="mt-1 text-white/50">
              {item.platform}
              {sizeText ? ` · ${sizeText}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <GameDownloadButton
              title={displayTitle}
              platform={item.platform}
              platformSlug={item.platformSlug}
              status={item.status}
              progress={item.progress}
              error={item.error}
              wishlistId={item.wishlistId}
              jobId={item.jobId}
              sizeText={sizeText}
              onChanged={() => startRefresh(() => router.refresh())}
            />
            <GameWatchlistButton
              gameKey={item.gameKey}
              title={displayTitle}
              platform={item.platform}
              initialInList={initialInWatchlist}
            />
          </div>
        </div>
      </div>

      {item.discs && item.discs.length > 0 && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Discs
            <span className="ml-2 text-sm font-normal text-white/40">{item.discs.length}</span>
          </h2>
          <ul className="space-y-1.5">
            {item.discs.map((d) => (
              <li
                key={d.romStem}
                className="flex items-center justify-between rounded border border-white/10 bg-black/20 px-3 py-2 text-sm"
              >
                <span className="text-white/80">{d.label}</span>
                <span className="text-white/40 tabular-nums">{formatFileSize(d.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10 border-t border-white/10 pt-8">
        <h2 className="mb-1 text-lg font-semibold text-white">Artwork</h2>
        {item.system && item.romStem ? (
          <>
            <p className="mb-4 text-sm text-white/50">
              Pick real cover art from SteamGridDB. Choosing here updates this game&apos;s poster in
              Streamy immediately, and reaches the Steam Deck the next time it checks in.
            </p>

            {/* Live layout preview -- banner behind, logo over it, cover
                overlapping bottom-left, icon badged bottom-right, roughly
                matching how Steam's own Big Picture library card is built
                out of these same four asset kinds. Updates the instant a
                pick is saved below, no reload needed. */}
            <div className="relative mb-6 aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-white/10 bg-white/5">
              {artwork.hero ? (
                <Image src={artwork.hero} alt="" fill unoptimized className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-white/25">
                  No banner picked yet
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              {artwork.logo && (
                <Image
                  src={artwork.logo}
                  alt=""
                  width={200}
                  height={80}
                  unoptimized
                  className="absolute bottom-4 right-4 max-h-16 w-auto object-contain drop-shadow"
                />
              )}
              <div className="absolute bottom-3 left-3 flex items-end gap-2">
                <div className="relative aspect-[2/3] w-16 shrink-0 overflow-hidden rounded border border-white/20 bg-black/40 shadow-lg">
                  {artwork.grid ? (
                    <Image src={artwork.grid} alt="" fill unoptimized className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-white/30">
                      No cover
                    </div>
                  )}
                </div>
                {artwork.icon && (
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded border border-white/20 bg-black/40 shadow-lg">
                    <Image src={artwork.icon} alt="" fill unoptimized className="object-cover" />
                  </div>
                )}
              </div>
            </div>

            <GameArtworkPicker
              system={item.system}
              romStem={item.romStem}
              savedKinds={savedKinds}
              initialArtwork={artwork}
              onArtworkSaved={(kind, url) =>
                setArtwork((prev) => ({ ...prev, [kind]: url ?? undefined }))
              }
            />
          </>
        ) : (
          <p className="text-sm text-white/50">
            Available once this game finishes downloading — there&apos;s no file to attach artwork to yet.
          </p>
        )}
      </div>
    </div>
  );
}
