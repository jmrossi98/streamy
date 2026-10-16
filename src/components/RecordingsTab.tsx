"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui";
import { ROW_H2_CLASS } from "@/lib/browseLayout";
import type { SportsGame } from "@/lib/sportarr";
import { SportsGameRow } from "@/components/SportsGameRow";

type Answer = { configured: boolean; downloading: SportsGame[]; ready: SportsGame[] };

/** How often the list is re-read while something is downloading. */
const DOWNLOAD_POLL_MS = 5_000;

async function readRecordings(): Promise<Answer> {
  const res = await fetch("/api/sports/recordings");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/**
 * The Recordings tab: every game Sportarr is fetching or has, each one
 * click from playing. Three empty states, kept apart for the same reason the
 * Live TV ones are -- "not configured", "can't reach it" and "nothing
 * recorded yet" each send someone to a different place.
 */
export function RecordingsTab() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState(false);

  // State is only ever set from the fetch's callbacks, never from the effect
  // body itself (react-hooks/set-state-in-effect).
  const load = useCallback(
    (isLive: () => boolean) =>
      readRecordings()
        .then((data) => {
          if (!isLive()) return;
          setAnswer(data);
          setError(false);
        })
        .catch(() => {
          if (isLive()) setError(true);
        }),
    []
  );

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  const downloading = (answer?.downloading.length ?? 0) > 0;
  useEffect(() => {
    if (!downloading) return;
    let live = true;
    const t = setInterval(() => void load(() => live), DOWNLOAD_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [downloading, load]);

  if (answer && !answer.configured) {
    return (
      <Panel className="mt-6 text-center">
        <p className="text-base font-semibold text-white/80">Sportarr isn’t configured</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          <code className="text-white/70">SPORTARR_URL</code> or <code className="text-white/70">SPORTARR_API_KEY</code> is unset
          on the server.
        </p>
      </Panel>
    );
  }
  if (error && !answer) {
    return (
      <Panel className="mt-6 text-center">
        <p className="text-base font-semibold text-white/80">Sportarr isn’t responding</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          Streamy is configured for Sportarr but it isn’t answering. Check that the container is running.
        </p>
      </Panel>
    );
  }
  if (!answer) return <p className="mt-6 text-sm text-white/40">Loading…</p>;

  if (answer.downloading.length === 0 && answer.ready.length === 0) {
    return (
      <Panel className="mt-6 text-center">
        <p className="text-base font-semibold text-white/80">No recordings yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          Pick a finished game on the Sports tab and choose Download. It shows up here while it downloads and once it’s ready to watch.
        </p>
      </Panel>
    );
  }

  // A row's own check/download answers replace it in whichever list it is
  // in; a download that finishes moves lists on the next poll.
  const replace = (next: SportsGame) =>
    setAnswer((a) =>
      a
        ? {
            ...a,
            downloading: a.downloading.map((g) => (g.id === next.id ? next : g)),
            ready: a.ready.map((g) => (g.id === next.id ? next : g)),
          }
        : a
    );

  return (
    <>
      {answer.downloading.length > 0 && (
        <section className="mb-8">
          <h2 className={ROW_H2_CLASS}>
            Downloading <span className="text-sm font-normal text-white/40">{answer.downloading.length}</span>
          </h2>
          <ul className="space-y-1">
            {answer.downloading.map((g) => (
              <SportsGameRow key={g.id} game={g} onChange={replace} />
            ))}
          </ul>
        </section>
      )}
      {answer.ready.length > 0 && (
        <section className="mb-8">
          <h2 className={ROW_H2_CLASS}>
            Ready to watch <span className="text-sm font-normal text-white/40">{answer.ready.length}</span>
          </h2>
          <ul className="space-y-1">
            {answer.ready.map((g) => (
              <SportsGameRow key={g.id} game={g} onChange={replace} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
