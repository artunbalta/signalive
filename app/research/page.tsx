import type { Metadata } from "next";
import AnnouncementBar from "@/components/chrome/AnnouncementBar";
import Nav from "@/components/chrome/Nav";
import { Beyond, Built, ExplorerSection, Findings, Meaning, Method, ReplaySection, ResearchHero } from "@/components/research/Sections";
import Footer from "@/components/sections/Footer";
import { research } from "@/lib/copy";

export const metadata: Metadata = {
  title: research.meta.title,
  description: research.meta.description,
  alternates: { canonical: "/research" },
  openGraph: {
    title: research.meta.title,
    description: research.meta.description,
    type: "article",
    url: "/research",
    images: [{ url: "/research/og.jpg", width: 1200, height: 630, alt: research.meta.ogAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title: research.meta.title,
    description: research.meta.description,
    images: ["/research/og.jpg"],
  },
};

/** No home page anchor lives here, so every nav link leads back home. */
const HERE: string[] = [];

/**
 * Research note 01: the decoder run on public ear EEG from 36 people, a live
 * replay of one recording through the earbud pipeline, what the numbers decide
 * about the hardware, and what is already built.
 */
export default function ResearchPage() {
  return (
    <>
      <AnnouncementBar base="/" here={HERE} />
      <Nav base="/" here={HERE} />
      <main id="main">
        <ResearchHero />
        <ReplaySection />
        <Findings />
        <Beyond />
        <ExplorerSection />
        <Meaning />
        <Built />
        <Method />
      </main>
      <Footer base="/" here={HERE} />
    </>
  );
}
