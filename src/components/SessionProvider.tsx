"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import type { ReactNode } from "react";

/**
 * `session` is read on the server and handed down (see app/layout.tsx).
 *
 * Without it, next-auth's provider treats the session as unknown and fetches
 * /api/auth/session from the browser on every page load. useSession() reports
 * "loading" for the whole of that round trip, and anything gated on
 * "authenticated" -- PosterWatchlistButton returns null, so every My List
 * button on the page -- simply is not in the DOM until it lands.
 */
export function SessionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  return (
    <NextAuthSessionProvider
      session={session}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
