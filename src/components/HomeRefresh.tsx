"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

/** Refreshes server data when returning to the home tab so Recently Watched is up to date. */
export function HomeRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const didRefresh = useRef(false);

  useEffect(() => {
    if (pathname !== "/") {
      didRefresh.current = false;
      return;
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && pathname === "/" && !didRefresh.current) {
        didRefresh.current = true;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pathname, router]);

  return null;
}
