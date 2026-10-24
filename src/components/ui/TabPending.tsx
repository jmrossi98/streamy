"use client";

import { useLinkStatus } from "next/link";

/**
 * Shows that a tab was tapped while its page is still on the way.
 *
 * Tab switches on server-rendered pages (Live TV's Now/Guide/Sports) wait for
 * the server before the URL -- and so the active underline -- changes. That
 * wait read as "selecting the other tabs doesn't respond" (2026-10-24). This
 * draws the underline immediately, pulsing, until the page arrives.
 */
export function TabPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 animate-pulse bg-netflix-red" />;
}
