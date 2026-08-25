/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,

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
    ],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
