"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PrefetchBack({ movieId }: { movieId: string }) {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(`/watch/${movieId}`);
  }, [router, movieId]);
  return null;
}
