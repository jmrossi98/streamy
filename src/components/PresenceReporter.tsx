"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { onUrgentPresence, presenceSessionId, takePresence } from "@/lib/presenceClient";

const VISIBLE_EVERY_MS = 20_000;
const HIDDEN_EVERY_MS = 60_000;

/**
 * A signed-in tab's heartbeat to /api/presence: the page it is on, what it is
 * playing, and the playback events since the last beat. It is what the admin
 * Security tab's Viewers panel is built from. Sends nothing when signed out.
 */
export function PresenceReporter() {
  const { status } = useSession();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const sendRef = useRef<(beacon?: boolean) => void>(() => {});

  useEffect(() => {
    if (status !== "authenticated") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let urgent: ReturnType<typeof setTimeout> | null = null;

    const send = (beacon = false) => {
      const body = JSON.stringify({ sessionId: presenceSessionId(), path: pathRef.current, ...takePresence() });
      try {
        if (beacon && navigator.sendBeacon) {
          navigator.sendBeacon("/api/presence", new Blob([body], { type: "text/plain" }));
          return;
        }
        void fetch("/api/presence", { method: "POST", body, keepalive: true }).catch(() => {});
      } catch {
        // A heartbeat must never break the page.
      }
    };
    sendRef.current = send;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          send();
          schedule();
        },
        document.visibilityState === "visible" ? VISIBLE_EVERY_MS : HIDDEN_EVERY_MS
      );
    };
    const onVisibility = () => {
      send(document.visibilityState === "hidden");
      schedule();
    };
    const onPageHide = () => send(true);

    onUrgentPresence(() => {
      if (urgent) return;
      urgent = setTimeout(() => {
        urgent = null;
        send();
      }, 2_000);
    });
    send();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (timer) clearTimeout(timer);
      if (urgent) clearTimeout(urgent);
      onUrgentPresence(null);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [status]);

  // A new page is news: say where, without waiting for the next beat.
  useEffect(() => {
    if (status === "authenticated") sendRef.current();
  }, [pathname, status]);

  return null;
}
