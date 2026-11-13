"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Notice } from "@/components/ui";
import {
  BANNER_POLL_OFFLINE_MS,
  BANNER_POLL_ONLINE_MS,
  offlineBannerText,
  type HomelabStatus,
} from "@/lib/homelabBreakerRules";

const subscribeNever = () => () => {};

/**
 * Says so while mediabox is off (2026-11-13). The pages themselves keep
 * working -- the server fails mediabox requests fast and falls back
 * (homelabBreaker.ts) -- but nothing plays, and a viewer should hear why
 * rather than guess.
 *
 * Starts from what the server knew at render, then asks /api/homelab-status
 * now and then (often while down, so it clears within seconds of mediabox
 * coming back), only while the tab is visible. A strip fixed under the navbar,
 * so it reads the same over a full-bleed hero as over the admin.
 */
export function HomelabBanner({ initial }: { initial: HomelabStatus }) {
  const [status, setStatus] = useState(initial);
  const current = useRef(initial);
  // The outage this viewer dismissed; a new one shows again.
  const [dismissed, setDismissed] = useState<number | null>(null);
  // The time is local to the viewer, which the server can't know: say it only
  // on the client, so the server's HTML and the first client render match.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(tick, current.current.online ? BANNER_POLL_ONLINE_MS : BANNER_POLL_OFFLINE_MS);
    };
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/homelab-status", { cache: "no-store" });
          if (res.status === 401) return; // signed out: nothing more to say
          if (res.ok) {
            const next = (await res.json()) as HomelabStatus;
            current.current = next;
            setStatus(next);
          }
        } catch {
          // Lightsail itself unreachable: keep what we last knew.
        }
      }
      if (!stopped) schedule();
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  if (status.online || dismissed === status.downSince) return null;
  const formatTime = mounted
    ? (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : undefined;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top,0px))] z-40 px-4 pt-2">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-md bg-netflix-black shadow-lg">
        <Notice tone="warning" onDismiss={() => setDismissed(status.downSince)}>
          {offlineBannerText(status.downSince, formatTime)}
        </Notice>
      </div>
    </div>
  );
}
