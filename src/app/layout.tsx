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
