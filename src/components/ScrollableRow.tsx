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
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    // Content shrank (e.g. removed from My List) — clamp scroll so arrow state matches overflow.
    if (el.scrollLeft > maxScroll) {
      el.scrollLeft = maxScroll;
    }
    const atStart = el.scrollLeft <= 1;
    const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft;
    setCanScrollLeft(!atStart);
    setCanScrollRight(remaining > 1);
  }, []);

  useEffect(() => {
    check();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(check);
    });
    ro.observe(el);
    // scrollWidth changes when children are removed; ResizeObserver often does not fire for that.
    const mo = new MutationObserver(() => {
      requestAnimationFrame(check);
    });
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
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
    <section className="relative px-4 pb-2 pt-2 sm:px-6">
      <h2 className="mb-2 font-display text-xl font-bold text-white sm:mb-3 sm:text-2xl md:text-3xl">
        {title}
      </h2>
      <div className="relative isolate flex items-center">
        {/* Always mount buttons so hover/focus never unmounts them; z-30 above .movie-card:hover (z-10) */}
        <button
          type="button"
          onClick={() => scrollByRow(-1)}
          disabled={!canScrollLeft}
          tabIndex={canScrollLeft ? 0 : -1}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-30 min-w-[44px] min-h-[44px] w-9 h-9 sm:w-9 sm:h-9 rounded-full bg-black/70 text-white/90 hover:bg-black/90 active:bg-black/90 hover:text-white hidden sm:flex items-center justify-center transition-all shadow-lg border border-white/20 pointer-events-auto ${
            canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-label="Scroll row left"
        >
          <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
          </svg>
        </button>
        <div ref={scrollRef} className="movie-row flex-1 min-w-0">
          {children}
        </div>
        <button
          type="button"
          onClick={() => scrollByRow(1)}
          disabled={!canScrollRight}
          tabIndex={canScrollRight ? 0 : -1}
          className={`absolute right-0 top-1/2 -translate-y-1/2 z-30 min-w-[44px] min-h-[44px] w-9 h-9 sm:w-9 sm:h-9 rounded-full bg-black/70 text-white/90 hover:bg-black/90 active:bg-black/90 hover:text-white hidden sm:flex items-center justify-center transition-all shadow-lg border border-white/20 pointer-events-auto ${
            canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-label="Scroll row right"
        >
          <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
        </button>
      </div>
    </section>
  );
}
