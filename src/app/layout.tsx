import type { Metadata } from "next";
import { Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

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
        <Navbar />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
