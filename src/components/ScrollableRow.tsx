"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ROW_H2_CLASS, ROW_SECTION_CLASS } from "@/lib/browseLayout";

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
    <section className={ROW_SECTION_CLASS}>
      <h2 className={ROW_H2_CLASS}>{title}</h2>
      {/*
        Full-bleed scroll container on ALL screen sizes:
        -mx-4 (mobile) / md:-mx-6 (desktop) cancels the section padding so the
        overflow clip edge sits at the invisible viewport edge — no visible "border."
        Scrollable spacers provide the initial gutter that scrolls away.
      */}
      <div className="group/row relative flex min-w-0 items-center -mx-4 md:-mx-6">
        <button
          type="button"
          onClick={() => scrollByRow(-1)}
          disabled={!canScrollLeft}
          tabIndex={canScrollLeft ? 0 : -1}
          className={`pointer-events-auto absolute top-1/2 z-30 hidden h-9 w-9 min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-lg shadow-black/50 transition-colors hover:bg-black/85 hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 md:flex md:left-0 ${
            canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-label="Scroll row left"
        >
          <svg
            className="h-5 w-5 shrink-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
          </svg>
        </button>
        <div ref={scrollRef} className="movie-row min-w-0 flex-1">
          {/* Width = desired gutter minus .movie-row gap (mobile 0.75rem / desktop 0.5rem)
             so spacer + gap = section padding → first poster aligns with row title.
             Mobile: 1rem - 0.75rem = 0.25rem (w-1). Desktop: 1.5rem - 0.5rem = 1rem (md:w-4). */}
          <div aria-hidden className="shrink-0 w-1 min-w-1 md:w-4 md:min-w-4 snap-start" />
          {children}
          <div aria-hidden className="shrink-0 w-1 min-w-1 md:w-4 md:min-w-4 snap-start" />
        </div>
        <button
          type="button"
          onClick={() => scrollByRow(1)}
          disabled={!canScrollRight}
          tabIndex={canScrollRight ? 0 : -1}
          className={`pointer-events-auto absolute top-1/2 z-30 hidden h-9 w-9 min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-lg shadow-black/50 transition-colors hover:bg-black/85 hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 md:flex md:right-0 ${
            canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-label="Scroll row right"
        >
          <svg
            className="h-5 w-5 shrink-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
        </button>
      </div>
    </section>
  );
}
