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
  // The expanded assistant: one screen, navbar plus a chat that fills the rest.
  // (/admin/chat left this list when it went back inside the admin layout
  // with an explicit height of its own.)
  return /^\/assistant\/?$/.test(pathname ?? "");
}

function isFullscreenRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    /^\/watch\/[^/]+\/play\/?$/.test(pathname) ||
    /^\/show\/[^/]+\/episode\/[^/]+\/[^/]+\/?$/.test(pathname) ||
    // A tailored resume: a printable page, so no site chrome to print.
    /^\/resume\/[^/]+\/?$/.test(pathname)
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreen = isFullscreenRoute(pathname);
  const chromeOnly = isChromeOnlyRoute(pathname);

  // A chrome-only route is one screen with no scrolling of its own, so the
  // navbar and the content have to share the viewport rather than stack past
  // it. Making the wrapper the 100dvh box and the main the flexible remainder
  // is what guarantees that: a 100dvh main *below* a navbar is taller than the
  // screen by exactly the navbar's height, which pushed the chat input off the
  // bottom -- under the browser's own toolbar, where it read as a block
  // covering the input.
  //
  // 100dvh, not 100vh: on mobile the browser chrome shrinks the visible area,
  // and vh doesn't account for it.
  if (chromeOnly) {
    return (
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-netflix-black">
        {!fullscreen && (
          // Sized, not just a wrapper: the navbar is position:fixed, so an
          // unsized slot collapsed to nothing and the page below slid under
          // it -- the assistant's model picker sat beneath the nav links.
          <div className="h-[calc(4rem+env(safe-area-inset-top,0px))] shrink-0">
            <Navbar />
          </div>
        )}
        <main className="w-full min-w-0 min-h-0 flex-1 overflow-hidden bg-netflix-black">
          {children}
        </main>
      </div>
    );
  }

  return (
    <>
      {!fullscreen && <Navbar />}
      <main className="w-full min-w-0 min-h-screen bg-netflix-black">{children}</main>
      {!fullscreen && <Footer />}
    </>
  );
}
