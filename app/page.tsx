import AnnouncementBar from "@/components/chrome/AnnouncementBar";
import Nav from "@/components/chrome/Nav";
import StickyCTA from "@/components/chrome/StickyCTA";
import Hero from "@/components/sections/Hero";
import OneClench from "@/components/sections/OneClench";
import Problem from "@/components/sections/Problem";
import HowItWorks from "@/components/sections/HowItWorks";
import ScrubSequence from "@/components/sections/ScrubSequence";
import ThePoint from "@/components/sections/ThePoint";
import Carousel from "@/components/sections/Carousel";
import NotMind from "@/components/sections/NotMind";
import Science from "@/components/sections/Science";
import Waitlist from "@/components/sections/Waitlist";
import Footer from "@/components/sections/Footer";

/**
 * One long scroll. Sections alternate ink and paper, full bleed, in the order
 * set out in the build spec part 3.
 *
 * The order deliberately puts the gesture channel in front of the argument for
 * it: OneClench is the second thing on the page, before the problem statement,
 * because what the product lets you DO is more striking than the listening
 * research that makes it possible.
 *
 * Sections stay server rendered rather than dynamically imported: the copy is
 * the substance of this page and it should exist without JavaScript. The heavy
 * parts that genuinely need splitting do it themselves, the audio engine via
 * next/dynamic inside the Hero and GSAP via an await import inside the pinned
 * scene and the scrub sequence.
 */
export default function Page() {
  return (
    <>
      <AnnouncementBar />
      <Nav />
      <main id="main">
        <Hero />
        <OneClench />
        <Problem />
        <HowItWorks />
        <ScrubSequence />
        <ThePoint />
        <Carousel />
        <NotMind />
        <Science />
        <Waitlist />
      </main>
      <Footer />
      <StickyCTA />
    </>
  );
}
