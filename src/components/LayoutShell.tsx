"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

function isFullscreenRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/watch\/[^/]+\/play\/?$/.test(pathname) || /^\/show\/[^/]+\/episode\/[^/]+\/[^/]+\/?$/.test(pathname);
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreen = isFullscreenRoute(pathname);

  return (
    <>
      {!fullscreen && <Navbar />}
      <main className="min-h-screen">{children}</main>
      {!fullscreen && <Footer />}
    </>
  );
}
