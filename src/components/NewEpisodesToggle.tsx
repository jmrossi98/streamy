"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Checkbox } from "./ui";

type Follow = { following: boolean; nextAiring: string | null };

function nextAiringLabel(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * "Download new episodes as they air" for one show -- one setting per show,
 * shared by everyone (see newEpisodeRules.ts). Only signed-in viewers can
 * change it, the same as requesting an episode. `onChanged` lets the episode
 * list pick up the newly wanted episodes.
 */
export function NewEpisodesToggle({ showId, onChanged, className }: { showId: string; onChanged?: () => void; className?: string }) {
  const { status: authStatus } = useSession();
  // Tagged with its show, so a different show never shows the last one's answer.
  const [state, setState] = useState<{ showId: string; follow: Follow } | null>(null);
  const follow = state?.showId === showId ? state.follow : null;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/requests/tv/follow?tmdbId=${encodeURIComponent(showId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Follow>) : null))
      .then((data) => {
        if (live && data) setState({ showId, follow: data });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [showId]);

  if (authStatus !== "authenticated" || !follow) return null;

  async function change(on: boolean) {
    if (!follow) return;
    const previous = follow;
    setState({ showId, follow: { ...follow, following: on } });
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch("/api/requests/tv/follow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: showId, following: on }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState({ showId, follow: (await res.json()) as Follow });
      onChanged?.();
    } catch {
      setState({ showId, follow: previous });
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const next = follow.following ? nextAiringLabel(follow.nextAiring) : null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${className ?? ""}`}>
      <Checkbox
        label="Download new episodes as they air"
        title="Each new episode downloads once it airs, for everyone. Episodes that already aired are not affected."
        checked={follow.following}
        disabled={saving}
        onChange={(e) => void change(e.target.checked)}
      />
      {failed ? (
        <span className="text-xs text-red-300">Couldn&apos;t save. Try again.</span>
      ) : next ? (
        <span className="text-xs text-white/45">Next episode {next}</span>
      ) : null}
    </div>
  );
}
