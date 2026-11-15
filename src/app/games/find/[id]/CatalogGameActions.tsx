"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Notice } from "@/components/ui";
import type { SystemStatus } from "@/lib/gameJobRules";

/** How often the rows re-read while anything is on its way. */
const POLL_MS = 5_000;

function inMotion(s: SystemStatus | undefined): boolean {
  return s?.state === "downloading" || s?.state === "queued" || s?.state === "importing";
}

function statusText(s: SystemStatus | undefined): string {
  switch (s?.state) {
    case "owned":
      return "In your library";
    case "downloading":
      return s.progress != null ? `Downloading ${s.progress}%` : "Downloading…";
    case "queued":
      return s.via === "gamarr" ? "Searching torrents and direct downloads…" : "Queued";
    case "importing":
      return "Adding to your library…";
    case "failed":
      return `Failed${s.message ? `: ${s.message}` : ""}`;
    default:
      return "";
  }
}

/**
 * A row per console: the game's state there, and the one action that fits
 * it -- Open (the library page, where its artwork is chosen) or Download.
 * Polls while anything is downloading or being filed.
 */
export function CatalogGameActions({
  igdbId,
  systems,
  initial,
}: {
  igdbId: number;
  systems: { slug: string; name: string }[];
  initial: Record<string, SystemStatus>;
}) {
  const [statuses, setStatuses] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "warning"; text: string } | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/games/catalog/status?igdbId=${igdbId}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { statuses: Record<string, SystemStatus> };
    setStatuses(body.statuses);
  }, [igdbId]);

  const moving = Object.values(statuses).some(inMotion);
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [moving, reload]);

  async function download(slug: string, name: string) {
    if (busy) return;
    setBusy(slug);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/games/catalog/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ igdbId, system: slug }),
      });
      const out = (await res.json().catch(() => ({ ok: false, error: "No answer." }))) as
        | { ok: true; via: "usenet"; release: string }
        | { ok: true; via: "gamarr" }
        | { ok: false; error: string };
      if (out.ok) {
        setMessage({
          tone: "info",
          text:
            out.via === "usenet"
              ? `${name}: downloading ${out.release} from usenet.`
              : `${name}: nothing on usenet, so gamarr is searching torrents and direct downloads.`,
        });
      } else setMessage({ tone: "warning", text: out.error });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">Get it for</p>
      <ul className="divide-y divide-white/5 rounded border border-white/10 bg-netflix-dark/60">
        {systems.map(({ slug, name }) => {
          const s = statuses[slug];
          return (
            <li key={slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-[8rem] flex-1 text-white/85">{name}</span>
              <span className={`text-xs ${s?.state === "failed" ? "text-amber-200/80" : "text-white/50"}`}>{statusText(s)}</span>
              {s?.state === "owned" ? (
                <Link href={`/games/${encodeURIComponent(s.gameKey)}`} className="text-xs font-medium text-white/80 underline hover:text-white">
                  Open
                </Link>
              ) : !inMotion(s) ? (
                <Button size="xs" variant="primary" onClick={() => void download(slug, name)} disabled={!!busy}>
                  {busy === slug ? "Finding a release…" : s?.state === "failed" ? "Try again" : "Download"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
