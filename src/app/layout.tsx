import type { Metadata, Viewport } from "next";
import { Bebas_Neue } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { HomeRefresh } from "@/components/HomeRefresh";
import { NavigationSync } from "@/components/NavigationSync";
import { LayoutShell } from "@/components/LayoutShell";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={bebas.variable}>
      <body className="min-h-screen bg-netflix-black font-sans antialiased">
        <SessionProvider>
          <HomeRefresh />
          <NavigationSync />
          <LayoutShell>{children}</LayoutShell>
        </SessionProvider>
      </body>
    </html>
  );
}
