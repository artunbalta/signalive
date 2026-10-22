import type { Metadata } from "next";
import AnnouncementBar from "@/components/chrome/AnnouncementBar";
import Nav from "@/components/chrome/Nav";
import StickyCTA from "@/components/chrome/StickyCTA";
import { Closing, FeaturesHero, FocusFeature, MoreFeatures, Privacy, RewindFeature } from "@/components/features/Sections";
import Footer from "@/components/sections/Footer";
import Waitlist from "@/components/sections/Waitlist";
import { features } from "@/lib/copy";

export const metadata: Metadata = {
  title: features.meta.title,
  description: features.meta.description,
  alternates: { canonical: "/features" },
  openGraph: {
    title: features.meta.title,
    description: features.meta.description,
    type: "website",
    url: "/features",
    images: [{ url: "/media/og.jpg", width: 1200, height: 630 }],
  },
};

/** Anchors this page has itself; every other home page anchor leads back home. */
const HERE = ["waitlist"];

/**
 * What the web trial does today, with the waitlist on the page twice: in the
 * first screen, and as the full section that ends it. The gesture channel
 * leads, as on the home page; surfaces alternate ink and paper.
 */
export default function FeaturesPage() {
  return (
    <>
      <AnnouncementBar base="/" here={HERE} />
      <Nav base="/" here={HERE} />
      <main id="main">
        <FeaturesHero />
        <RewindFeature paper />
        <FocusFeature paper={false} />
        <MoreFeatures paper />
        <Privacy paper={false} />
        <Closing paper />
        {/* Ink after ink until the trial is public: a hairline parts them, as
            it parts the footer from this same section on the home page. */}
        <div className="border-t border-hairline">
          <Waitlist />
        </div>
      </main>
      <Footer base="/" here={HERE} />
      <StickyCTA heroId="features-hero" />
    </>
  );
}
