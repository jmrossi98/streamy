import type { Metadata } from "next";
import { Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SessionProvider } from "@/components/SessionProvider";
import { HomeRefresh } from "@/components/HomeRefresh";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-netflix",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Streamy - Watch TV Shows & Movies Online",
  description: "Watch unlimited movies and TV shows. Stream anywhere. Cancel anytime.",
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
          <Navbar />
          <main className="min-h-screen">{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
