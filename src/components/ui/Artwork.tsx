import { artSrcSet, type ArtKind } from "@/lib/tmdbImageRules";
import { cx } from "./index";

type Props = {
  src: string;
  alt: string;
  kind: ArtKind;
  /** The CSS width the image is drawn at, as the `sizes` attribute wants it. */
  sizes: string;
  className?: string;
  /** Above the fold: fetched at once, ahead of everything else. */
  priority?: boolean;
};

/**
 * A TMDB image that fills its (relatively positioned) parent, drawn straight
 * from TMDB's CDN at about the size it is shown.
 *
 * A plain <img>, not next/image: every poster already bypassed the optimizer
 * (`unoptimized`), and the ones that did not -- cast headshots, search
 * results, player backdrops -- made the production box fetch and re-encode
 * each picture before the browser saw it. The srcset (tmdbImageRules.ts)
 * does what the optimizer was there for, with TMDB's own pre-sized files:
 * a phone no longer downloads a w500 poster for a 160 px tile, and a cast
 * row fills in as fast as TMDB serves it. Lazy by default, like next/image.
 */
export function Artwork({ src, alt, kind, sizes, className, priority = false }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      srcSet={artSrcSet(src, kind)}
      sizes={sizes}
      alt={alt}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      className={cx("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
