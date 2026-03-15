"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type ScrollableRowProps = {
  title: string;
  children: React.ReactNode;
};

function useRowScrollState(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const check = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft;
    setCanScrollLeft(!atStart);
    setCanScrollRight(remaining > 1);
  }, []);

  useEffect(() => {
    check();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [check]);

  return { canScrollLeft, canScrollRight };
}

export function ScrollableRow({ title, children }: ScrollableRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { canScrollLeft, canScrollRight } = useRowScrollState(scrollRef);

  function scrollByRow(direction: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * direction;
    el.scrollBy({ left: amount, behavior: "smooth" });
  }

  return (
    <section className="px-4 sm:px-6 pt-2 pb-2 relative">
      <h2 className="font-display text-xl sm:text-2xl md:text-3xl font-bold text-white mb-2">
        {title}
      </h2>
      <div className="relative flex items-center">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByRow(-1)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 min-w-[44px] min-h-[44px] w-9 h-9 sm:w-9 sm:h-9 rounded-full bg-black/70 text-white/90 hover:bg-black/90 active:bg-black/90 hover:text-white flex items-center justify-center transition-colors shadow-lg border border-white/20 touch-manipulation"
            aria-label="Scroll row left"
          >
            <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
            </svg>
          </button>
        )}
        <div ref={scrollRef} className="movie-row flex-1 min-w-0">
          {children}
        </div>
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByRow(1)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 min-w-[44px] min-h-[44px] w-9 h-9 sm:w-9 sm:h-9 rounded-full bg-black/70 text-white/90 hover:bg-black/90 active:bg-black/90 hover:text-white flex items-center justify-center transition-colors shadow-lg border border-white/20 touch-manipulation"
            aria-label="Scroll row right"
          >
            <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}
