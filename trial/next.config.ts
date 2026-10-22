import type { NextConfig } from "next";

/**
 * Microphone access is the whole product, so Permissions-Policy grants it to
 * this origin only; the camera too, for head tracking on the Focus screen
 * (frames stay in the browser). Nothing here enables cross-origin isolation: the VAD runs
 * single threaded, which keeps third-party scripts and embeds unaffected.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(self), geolocation=(), bluetooth=(self), hid=(self)",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Vendored runtime files are versioned by the npm lockfile, not by
        // their URL, so they get a short cache rather than immutable.
        source: "/vendor/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
