import { cardArt } from "@/lib/tmdbImageRules";

/**
 * The picture on a 16:9 movie or show card: the backdrop at a card size, or
 * the whole poster when a title has none (tmdbImageRules.ts). A plain <img>
 * so the browser picks from TMDB's own sizes, like the hero.
 */
export function CardArt({
  backdrop,
  poster,
  alt,
  sizes,
}: {
  backdrop: string;
  poster: string;
  alt: string;
  sizes: string;
}) {
  const art = cardArt(backdrop, poster);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={art.src}
      srcSet={art.srcSet}
      sizes={sizes}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`absolute inset-0 h-full w-full ${art.fit === "cover" ? "object-cover" : "object-contain"}`}
    />
  );
}
