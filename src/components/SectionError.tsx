"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The error UI for one section of the app, rather than all of it.
 *
 * Until these existed there was a single error.tsx at the app root, so any
 * throw anywhere took the whole app with it -- and it threw a developer's page
 * at whoever was watching, citing `docker logs`, RUN_MIGRATE and NEXTAUTH_URL.
 * That is the right page for the root, where the cause really is likely to be
 * boot configuration. It is the wrong page for Live TV failing because the
 * home server is mid-reboot, which is both far more common and entirely
 * survivable: everything else on the site still works.
 *
 * A route segment with its own error.tsx keeps the navbar, the footer and
 * every other tab alive, and says which dependency is unavailable instead of
 * implying the site is broken.
 */
export function SectionError({
  section,
  dependency,
  error,
  reset,
}: {
  /** What the viewer was trying to use, in their words. e.g. "Live TV". */
  section: string;
  /** What it needs, in their words. e.g. "the home media server". */
  dependency: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest is the only handle on the server-side stack: React replaces the
    // real message with a generic one in production, and the digest is what
    // ties this render to the logged error on the server.
    console.error(`[${section}] section error:`, error.digest ?? "", error);
  }, [error, section]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-2 font-display text-2xl font-bold text-white">
        {section} is unavailable
      </h1>
      <p className="mb-6 max-w-md text-sm text-white/70">
        This usually means {dependency} is not reachable right now. The rest of
        Streamy is unaffected.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-white px-4 py-2 font-medium text-netflix-black transition-colors hover:bg-white/90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded border border-white/30 px-4 py-2 font-medium text-white transition-colors hover:bg-white/10"
        >
          Back to home
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 font-mono text-[11px] text-white/35">
          reference {error.digest}
        </p>
      )}
    </div>
  );
}
