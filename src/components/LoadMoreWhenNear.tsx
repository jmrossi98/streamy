"use client";

import { useEffect, useRef } from "react";

/**
 * An invisible marker at the end of a list that asks for more of it as the
 * page scrolls near -- so every item is reachable by scrolling, with no "Show
 * more" button to press. `onNear` runs again while the marker stays in range
 * (each time `count` grows), so a tall screen fills up in one go.
 */
export function LoadMoreWhenNear({ onNear, count, ahead = 800 }: { onNear: () => void; count: number; ahead?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useRef(onNear);
  useEffect(() => {
    near.current = onNear;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) near.current();
    }, { rootMargin: `0px 0px ${ahead}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [count, ahead]);
  return <div ref={ref} aria-hidden className="h-px" />;
}
