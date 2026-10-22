import type { Metadata } from "next";
import AnnouncementBar from "@/components/chrome/AnnouncementBar";
import Nav from "@/components/chrome/Nav";
import { Closing, FeaturesHero, FocusFeature, MoreFeatures, Privacy, RewindFeature } from "@/components/features/Sections";
import Footer from "@/components/sections/Footer";
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

/**
 * What the web trial does today. The gesture channel leads, as on the home
 * page; surfaces alternate ink and paper, ending on paper before the footer.
 * The shared chrome gets base "/" so its in-page anchors lead back home.
 */
export default function FeaturesPage() {
  return (
    <>
      <AnnouncementBar base="/" />
      <Nav base="/" />
      <main id="main">
        <FeaturesHero />
        <RewindFeature paper />
        <FocusFeature paper={false} />
        <MoreFeatures paper />
        <Privacy paper={false} />
        <Closing paper />
      </main>
      <Footer base="/" />
    </>
  );
}
