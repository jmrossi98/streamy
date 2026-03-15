"use client";

import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * On pathname change: scroll to top and refresh router so the new page is shown
 * after compile. Fixes "stuck" navigation where a second click was needed.
 */
export function NavigationSync() {
  const pathname = usePathname();
  const router = useRouter();
  const prevPathname = useRef<string | null>(null);

  useEffect(() => {
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;

    window.scrollTo(0, 0);

    const t = setTimeout(() => {
      router.refresh();
    }, 50);

    return () => clearTimeout(t);
  }, [pathname, router]);

  return null;
}
