"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { onUrgentPresence, presenceSessionId, takePresence } from "@/lib/presenceClient";

const VISIBLE_EVERY_MS = 20_000;
const HIDDEN_EVERY_MS = 60_000;
/** After the server refuses a beat (401): how long before trying again. */
const REFUSED_RETRY_MS = 60_000;
/** The clock that drives everything; each tick decides whether a beat is due. */
const TICK_MS = 5_000;

/**
 * A signed-in tab's heartbeat to /api/presence: the page it is on, what it is
 * playing, and the playback events since the last beat. It is what the admin
 * Viewers panel is built from. Sends nothing until signed in.
 *
 * Once signed in, it keeps beating no matter what next-auth's client-side
 * status does afterwards. 2026-10-25: Jake's player tab streamed an episode
 * for two hours and never appeared in "On now" -- its beats stopped the
 * second its session was refetched in the background, and the old loop,
 * gated on `status === "authenticated"` and chained through setTimeout,
 * never came back (the tab's video and progress saves ran on fine). The
 * server is the authority on whether a beat is welcome: a 401 pauses beats
 * for a minute, then they resume on their own. A tick clock, not a chain,
 * so one failed beat cannot end the heartbeat.
 */
export function PresenceReporter() {
  const { status } = useSession();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  // Sticky: once this tab has been signed in, it reports until the server
  // says otherwise. (Latched during render, the React way to derive state.)
  const [armed, setArmed] = useState(status === "authenticated");
  if (status === "authenticated" && !armed) setArmed(true);
  const sendRef = useRef<(beacon?: boolean) => void>(() => {});

  useEffect(() => {
    if (!armed) return;
    let lastBeatAt = 0;
    let refusedUntil = 0;
    let urgent: ReturnType<typeof setTimeout> | null = null;

    const send = (beacon = false) => {
      try {
        if (Date.now() < refusedUntil) return;
        lastBeatAt = Date.now();
        const body = JSON.stringify({ sessionId: presenceSessionId(), path: pathRef.current, ...takePresence() });
        if (beacon && navigator.sendBeacon) {
          navigator.sendBeacon("/api/presence", new Blob([body], { type: "text/plain" }));
          return;
        }
        void fetch("/api/presence", { method: "POST", body, keepalive: true })
          .then((res) => {
            // Not signed in (any more): stop asking for a while. Anything
            // else -- a deploy's 502, a dropped connection -- is just a
            // missed beat, and the next tick sends another.
            if (res.status === 401) refusedUntil = Date.now() + REFUSED_RETRY_MS;
          })
          .catch(() => {});
      } catch {
        // A heartbeat must never break the page, nor end the heartbeat.
      }
    };
    sendRef.current = send;

    const tick = () => {
      const every = document.visibilityState === "visible" ? VISIBLE_EVERY_MS : HIDDEN_EVERY_MS;
      if (Date.now() - lastBeatAt >= every) send();
    };
    const onVisibility = () => send(document.visibilityState === "hidden");
    const onPageHide = () => send(true);

    onUrgentPresence(() => {
      if (urgent) return;
      urgent = setTimeout(() => {
        urgent = null;
        send();
      }, 2_000);
    });
    send();
    const timer = setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      if (urgent) clearTimeout(urgent);
      onUrgentPresence(null);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [armed]);

  // A new page is news: say where, without waiting for the next beat.
  useEffect(() => {
    if (armed) sendRef.current();
  }, [pathname, armed]);

  return null;
}
