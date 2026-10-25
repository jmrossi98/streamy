import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and linked from every page by Next. With
// this in place, Safari's Share -> Add to Home Screen (and Chrome's install
// prompt on Android) gives Streamy its own icon and opens it full-screen with
// no browser chrome. iOS takes the icon from app/apple-icon.png rather than
// from here; the PNGs come from scripts/make-pwa-icons.py.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Streamy",
    short_name: "Streamy",
    description: "Watch unlimited movies and TV shows. Stream anywhere.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
