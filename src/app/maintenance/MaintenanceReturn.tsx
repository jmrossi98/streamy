"use client";

import { useEffect } from "react";

/** How often the maintenance page asks whether the site is back. */
const CHECK_EVERY_MS = 30_000;

/**
 * Takes the viewer back to what they asked for once maintenance is over: the
 * proxy shows this page at their own address, so a reload is all it takes.
 */
export function MaintenanceReturn() {
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/site-status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { maintenance?: boolean } | null) => {
          if (d && d.maintenance === false) window.location.reload();
        })
        .catch(() => {});
    }, CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return null;
}
