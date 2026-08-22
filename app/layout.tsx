import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { meta, a11y } from "@/lib/copy";
import SmoothScroll from "@/components/SmoothScroll";
import PageLoader from "@/components/chrome/PageLoader";

/**
 * PP Neue Montreal is not licensable here, so the spec's stated fallback is
 * used: Inter Tight for display, with no serif anywhere on the site (spec 2.3).
 * next/font self hosts these as WOFF2 with font-display: swap. Only the display
 * face is preloaded (spec 6.2).
 */
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
  weight: ["500"],
  preload: true,
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500"],
  preload: false,
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["500"],
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL("https://signalive.com"),
  title: meta.title,
  description: meta.description,
  openGraph: {
    title: meta.title,
    description: meta.description,
    type: "website",
    images: [{ url: "/media/og.jpg", width: 1200, height: 630, alt: a11y.heroVideoAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title: meta.title,
    description: meta.description,
    images: ["/media/og.jpg"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  width: "device-width",
  initialScale: 1,
};


/**
 * Decides before first paint whether the intro sequence runs, and marks the
 * document so CSS can hold the hero content at its start state. Inline and
 * synchronous on purpose: doing this after hydration would flash the revealed
 * hero for a frame. Skipped for repeat visitors in the same session and for
 * anyone who asked for reduced motion (spec 4.7).
 */
const introScript = `(function(){try{
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = false;
  try { seen = sessionStorage.getItem("signalive:seen-intro") === "1"; } catch (e) {}
  if (!reduced && !seen) document.documentElement.setAttribute("data-intro","");
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: introScript }} />
      </head>
      <body>
        <PageLoader />
        <a href="#main" className="skip-link">
          {a11y.skipToContent}
        </a>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
