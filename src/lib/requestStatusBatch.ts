"use client";

import { statusKey } from "@/lib/posterDownloadRules";

/**
 * Collects the status lookups of every tile that mounts in the same moment
 * into one request, and remembers the answers for the session's page views.
 */
const known = new Map<string, string | null>();
const waiting = new Map<string, ((s: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = new Map(waiting);
  waiting.clear();
  let statuses: Record<string, string> = {};
  try {
    const res = await fetch("/api/requests/statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: [...batch.keys()] }),
    });
    if (res.ok) statuses = (await res.json()).statuses ?? {};
  } catch {
    // Unknown status just shows the plain download button.
  }
  for (const [k, cbs] of batch) {
    const s = statuses[k] ?? null;
    known.set(k, s);
    cbs.forEach((cb) => cb(s));
  }
}

export function lookupRequestStatus(mediaType: string, tmdbId: string, cb: (s: string | null) => void) {
  const k = statusKey(mediaType, tmdbId);
  if (known.has(k)) return cb(known.get(k)!);
  const list = waiting.get(k);
  if (list) list.push(cb);
  else waiting.set(k, [cb]);
  timer ??= setTimeout(flush, 30);
}

export function rememberRequestStatus(mediaType: string, tmdbId: string, status: string | null) {
  known.set(statusKey(mediaType, tmdbId), status);
}
