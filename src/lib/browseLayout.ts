/**
 * Shared wrapper for browse pages (movies, TV, watchlist).
 * Horizontal inset comes from each {@link ScrollableRow} section — not from this wrapper.
 */
export const BROWSE_PAGE_CLASS = "min-h-screen w-full min-w-0 pt-24 pb-12";

/** Mobile `px-4` matches Hero; carousel scrolls inside that inset (no extra leading spacer / -mx). */
export const ROW_SECTION_CLASS =
  "relative pb-2 pt-2 max-md:px-4 md:px-6";

/** Typography — row titles rely on section padding on mobile (do not add extra px-4 on h2). */
export const ROW_H2_CLASS =
  "mb-2 font-display text-xl font-bold text-white sm:mb-3 sm:text-2xl md:text-3xl";

/** Body copy in row sections — section padding handles mobile inset */
export const ROW_INLINE_TEXT_CLASS = "text-sm text-white/60";
