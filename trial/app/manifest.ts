import type { MetadataRoute } from "next";

/**
 * The installed app: Signalive, full screen, ink from the first frame, and
 * opening on Moments (a first visit is sent to the consent screen from
 * there). The icons are the app icon at 192 and 512 pixels; the maskable
 * ones carry the mark inside the safe circle, for launchers that crop.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Signalive",
    short_name: "Signalive",
    description: "Clench, and the moment is kept: what was said, a short summary and what to do, on your phone.",
    start_url: "/moments",
    scope: "/",
    display: "standalone",
    background_color: "#0B0B0C",
    theme_color: "#0B0B0C",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
