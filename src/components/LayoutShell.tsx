"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

/**
 * Keeps the navbar but drops the footer, and pins the main area to the
 * viewport so the page itself never scrolls. The chat transcript does its own
 * scrolling inside that box -- a footer below it would push the input off
 * screen and put a second scrollbar on the page.
 */
function isChromeOnlyRoute(pathname: string | null): boolean {
  return /^\/admin\/chat\/?$/.test(pathname ?? "");
}

function isFullscreenRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/watch\/[^/]+\/play\/?$/.test(pathname) || /^\/show\/[^/]+\/episode\/[^/]+\/[^/]+\/?$/.test(pathname);
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreen = isFullscreenRoute(pathname);
  const chromeOnly = isChromeOnlyRoute(pathname);

  return (
    <>
      {!fullscreen && <Navbar />}
      <main
        className={`w-full min-w-0 bg-netflix-black ${
          // 100dvh, not 100vh: on mobile the browser chrome shrinks the visible
          // area, and vh doesn't account for it -- the input ends up under it.
          chromeOnly ? "h-[100dvh] overflow-hidden" : "min-h-screen"
        }`}
      >
        {children}
      </main>
      {!fullscreen && !chromeOnly && <Footer />}
    </>
  );
}
