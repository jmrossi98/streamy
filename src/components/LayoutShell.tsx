"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useVisualViewportBox } from "@/hooks/useVisualViewportBox";

/**
 * Drops the footer and pins the main area to the viewport so the page itself
 * never scrolls. The chat transcript does its own scrolling inside that box --
 * a footer below it would push the input off screen and put a second
 * scrollbar on the page. (The navbar went too, 2026-10-24: a chat app is the
 * chat, and the page links back to the admin area itself.)
 */
function isChromeOnlyRoute(pathname: string | null): boolean {
  // The expanded assistant: one screen, a chat that fills all of it.
  // (/admin/chat left this list when it went back inside the admin layout
  // with an explicit height of its own.)
  return /^\/assistant\/?$/.test(pathname ?? "");
}

function isFullscreenRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    /^\/watch\/[^/]+\/play\/?$/.test(pathname) ||
    /^\/show\/[^/]+\/episode\/[^/]+\/[^/]+\/?$/.test(pathname) ||
    // A game recording: same full-screen player, so no navbar over its X.
    /^\/live\/recordings\/[^/]+\/?$/.test(pathname) ||
    // A tailored resume: a printable page, so no site chrome to print.
    /^\/resume\/[^/]+\/?$/.test(pathname) ||
    // The expanded assistant: the whole screen is the chat, like any chat
    // app; it carries its own link back to the admin area.
    /^\/assistant\/?$/.test(pathname)
  );
}

/**
 * One screen, sized to what is actually visible: the keyboard shrinks it, so
 * the chat's input stays just above the keys (see useVisualViewportBox). The
 * document itself is locked while this is shown -- the body's safe-area
 * padding otherwise leaves it a few px scrollable, which is enough for iOS to
 * drag the whole app around under a finger.
 */
function ChromeOnlyScreen({ children }: { children: React.ReactNode }) {
  const { style } = useVisualViewportBox();
  useEffect(() => {
    document.documentElement.classList.add("one-screen");
    return () => document.documentElement.classList.remove("one-screen");
  }, []);
  return (
    <div className="fixed inset-x-0 top-0 flex flex-col overflow-hidden bg-netflix-black" style={style}>
      {children}
    </div>
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
  // The box is the visual viewport, not 100dvh: neither vh nor dvh shrinks
  // for the on-screen keyboard on iOS.
  if (chromeOnly) {
    return (
      <ChromeOnlyScreen>
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
      </ChromeOnlyScreen>
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
