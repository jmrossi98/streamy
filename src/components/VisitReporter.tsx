"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Reports this app's own page views, mirroring the beacon on the portfolio.
 *
 * Same collect endpoint, site "streamy". It fires on every path change, so
 * client-side navigation counts rather than only the first load. This runs for
 * anyone with the app open -- which, since the app is behind auth, means
 * authenticated users; the "who is accessing Streamy" picture is completed by
 * the login-attempt stream, which also catches access that never got in.
 *
 * Fire-and-forget and wrapped so analytics can never break a page.
 */
export function VisitReporter() {
  const pathname = usePathname();

  useEffect(() => {
    // Never report the admin's own tour of the admin area as visitor traffic;
    // it would swamp the map with the one person who is always here.
    if (pathname.startsWith("/admin")) return;

    try {
      const body = JSON.stringify({ site: "streamy", path: pathname, referrer: document.referrer || null });
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/analytics/collect", blob);
      } else {
        void fetch("/api/analytics/collect", { method: "POST", body: blob, keepalive: true });
      }
    } catch {
      // Analytics must never throw into the page.
    }
  }, [pathname]);

  return null;
}
