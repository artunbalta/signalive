import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // The audio engine and scroll machinery are heavy; keep them out of the
  // first-paint graph. See docs/PERFORMANCE.md.
  experimental: {
    optimizePackageImports: ["gsap"],
  },
};

export default nextConfig;
