"use client";

import type { SelectHTMLAttributes } from "react";

/**
 * The standard Streamy dropdown.
 *
 * The same select styling had been written out by hand in the job listings
 * panel, the live TV filters and the games browser, and the downloads panel
 * had drifted into a fourth variant that looked different from all of them.
 * The look lives here now, so a new dropdown matches by default rather than
 * by someone remembering the class string.
 *
 * `streamy-select` carries the arrow and the option-list styling from the
 * global stylesheet -- including the dark `color-scheme`, which is the only
 * thing that styles the native option popup on Windows.
 */
export function StreamySelect({
  className = "",
  size = "sm",
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  /** Not the native `size` attribute (a row count) -- this is the control scale. */
  size?: "sm" | "md";
}) {
  const scale = size === "md" ? "py-2 pl-3 text-sm" : "py-1.5 pl-3 text-xs";
  return (
    <select
      {...props}
      className={`streamy-select rounded border border-white/15 bg-black/40 text-white focus:border-white/40 focus:outline-none ${scale} ${className}`}
    />
  );
}
