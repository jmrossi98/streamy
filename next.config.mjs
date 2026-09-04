/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,

  // `next dev` only -- no effect on a production build/start. Playwright's
  // player-control suite (playwright.config.ts) drives the dev server via
  // 127.0.0.1, which Next's dev-origin protection otherwise treats as
  // cross-origin from whatever it expects and silently 403s every JS chunk
  // request. That doesn't fail the page load or the click -- the DOM still
  // renders from SSR HTML and looks perfectly clickable -- it just means
  // React never finishes hydrating, so no click handler is ever attached and
  // every interaction in the suite silently no-ops. Confirmed live: three
  // core chunks 403ing, zero console output from inside any onClick handler.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Also `next dev` only. The dev-mode build-activity indicator's portal
  // covers a click-interceptable area even while not visibly showing
  // anything, which made every *second* click in the Playwright suite above
  // (the first already having triggered a re-render) retry-and-fail against
  // "<nextjs-portal> intercepts pointer events" until its own 30s+ retry
  // budget ran out.
  devIndicators: false,

  // Node-only libraries the geolocation code uses. Marked external so Next
  // keeps them as runtime requires and traces them (with their transitive
  // deps) into the standalone output, instead of trying to bundle them and
  // silently dropping them -- which is exactly what happened: the container
  // would fail with "Cannot find module 'maxmind'" the moment the visitor map
  // rendered. maxmind reads the .mmdb via node:fs; tar extracts the download.
  serverExternalPackages: ["maxmind", "mmdb-lib", "tar"],

  // ── Build speed ──────────────────────────────────────────────
  // Skip linting & type-checking during `next build` (run separately via `npm run lint` / `typecheck`)
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Don't emit browser source maps in production (saves ~30% of build I/O)
  productionBrowserSourceMaps: false,

  experimental: {
    // Tree-shake barrel exports — skips unused re-exports at build time
    optimizePackageImports: [
      "next-auth",
      "react-dom",
      "@prisma/client",
    ],
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org", pathname: "/**" },
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
      { protocol: "https", hostname: "placehold.co", pathname: "/**" },
      // ROM artwork candidates in the admin games panel's picker.
      { protocol: "https", hostname: "cdn2.steamgriddb.com", pathname: "/**" },
    ],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
