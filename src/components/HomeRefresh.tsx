"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

/** Refreshes server data when landing on home so Recently Watched progress is up to date. */
export function HomeRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/") {
      router.refresh();
    }
  }, [pathname, router]);

  return null;
}
