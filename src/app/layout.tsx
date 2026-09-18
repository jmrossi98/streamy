import type { Metadata, Viewport } from "next";
import { Bebas_Neue } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { getWatchlistSnapshot } from "@/lib/watchlistSnapshot";
import { SessionProvider } from "@/components/SessionProvider";
import { WatchlistProvider } from "@/contexts/WatchlistContext";
import { HomeRefresh } from "@/components/HomeRefresh";
import { LayoutShell } from "@/components/LayoutShell";
import { VisitReporter } from "@/components/VisitReporter";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-netflix",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Streamy - Watch TV Shows & Movies Online",
  description: "Watch unlimited movies and TV shows. Stream anywhere. Cancel anytime.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Streamy" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#141414",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Both are read here rather than on the client, and both are React-cached per
  // request, so a page that also calls getSession() pays for one lookup, not
  // two. See lib/watchlistSnapshot.ts for why this matters more than it looks:
  // it is the difference between My List buttons existing at first paint and
  // appearing two network round trips later.
  const session = await getSession();
  const watchlist = await getWatchlistSnapshot(session);

  return (
    <html lang="en" className={bebas.variable}>
      <head>
        {/*
          Every poster on every page comes from image.tmdb.org, and they are
          rendered `unoptimized` -- so the browser goes to TMDB directly rather
          than through this server. That is the right call, but it means the
          first poster pays for a DNS lookup, a TCP handshake and a TLS
          negotiation to a host the browser has never seen, and it pays for it
          only once the HTML has parsed far enough to find an <img>. Starting
          that handshake in the document head runs it in parallel with the rest
          of the page instead.
        */}
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
      </head>
      <body className="min-h-screen bg-netflix-black font-sans antialiased">
        <SessionProvider session={session}>
          <WatchlistProvider initial={watchlist}>
            <HomeRefresh />
            <VisitReporter />
            <LayoutShell>{children}</LayoutShell>
          </WatchlistProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
