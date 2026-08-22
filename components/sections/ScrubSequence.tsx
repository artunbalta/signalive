"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { eartip } from "@/lib/copy";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";

/**
 * The scroll scrubbed turntable. Spec 4.5.
 *
 * This is an image sequence, not a video, on purpose. Seeking a video frame by
 * frame from a scroll handler is unreliable across browsers: Safari in
 * particular throttles and coalesces seeks on a paused video, so the rotation
 * stutters or freezes entirely while the scrollbar keeps moving. Sixty decoded
 * WebP frames drawn to a canvas give exact, synchronous control at the cost of
 * about 280KB, which we pay up front and honestly report while it loads.
 *
 * There is no headline for this section. The object is the argument.
 */

const FRAME_COUNT = 60;
const FRAME_SRC = (i: number) =>
  `/media/seq/frame-${String(i).padStart(3, "0")}.webp`;

/** Intrinsic size of every frame, used until the first one reports its own. */
const FRAME_W = 1000;
const FRAME_H = 562;

/** Scroll distance the pin holds for, in viewport heights. Spec 4.5. */
const SCROLL_VH = 1.75;

/**
 * The source frames are 1000px wide, so drawing much wider than this is
 * upscaling. Capping keeps the earbud a considered object on a large display
 * rather than a soft billboard.
 */
const MAX_DRAW_W = 880;

const FIGURE_ID = "scrub-figure";
const HEADING_ID = "scrub-heading";

/** Dissolves the frame's studio ground into the section rather than leaving a
 *  lighter rectangle sitting on the page. */
const EDGE_FADE =
  "radial-gradient(ellipse 62% 62% at 50% 50%, #000 38%, rgba(0,0,0,0.62) 68%, transparent 100%)";

/** Not copy. This is the accessible description of a wordless section. */
const STILL_ALT =
  "The earbud turned so the eartip faces the camera, showing the two concentric contact rings set flush into the silicone tip.";

export default function ScrubSequence() {
  const reduced = useReducedMotion();

  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const framesRef = useRef<HTMLImageElement[]>([]);
  /** CSS pixel size of the canvas box, kept separate from its backing store. */
  const sizeRef = useRef({ w: 0, h: 0 });
  /** Last index actually painted, so a resize can repaint the same frame. */
  const drawnRef = useRef(0);

  const [settled, setSettled] = useState(0);
  const [ready, setReady] = useState(false);

  /* ---------------------------------------------------------------- paint */

  const draw = useCallback((index: number) => {
    const ctx = ctxRef.current;
    const img = framesRef.current[index];
    const { w, h } = sizeRef.current;
    if (!ctx || !w || !h) return;
    // A frame that failed to decode leaves the previous one on screen rather
    // than flashing a hole in the rotation.
    if (!img || !img.complete || img.naturalWidth === 0) return;

    ctx.clearRect(0, 0, w, h);

    const iw = img.naturalWidth || FRAME_W;
    const ih = img.naturalHeight || FRAME_H;
    // Contain inside a box inset from the pinned viewport, so the object never
    // touches the edges regardless of aspect ratio.
    const boxW = Math.min(w * 0.88, MAX_DRAW_W);
    const boxH = h * 0.78;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

    drawnRef.current = index;
  }, []);

  /* ------------------------------------------------- canvas sizing + DPR */

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (!w || !h) return;

      // Cap at 2. The frames are only 1000px wide, so a 3x backing store buys
      // nothing but memory and fill rate.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      // Assigning width or height resets the context, so fetch and re-scale it
      // here rather than caching a context from mount.
      const ctx = canvas.getContext("2d");
      ctxRef.current = ctx;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      sizeRef.current = { w, h };
      draw(drawnRef.current);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [reduced, draw]);

  /* -------------------------------------------------------------- preload */

  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    if (!section) return;

    let cancelled = false;
    const images: HTMLImageElement[] = [];

    const load = () => {
      framesRef.current = images;
      setSettled(0);

      let done = 0;
      const settle = () => {
        if (cancelled) return;
        done++;
        setSettled(done);
        if (done === FRAME_COUNT) setReady(true);
      };

      for (let i = 0; i < FRAME_COUNT; i++) {
        const img = new Image();
        // Errors settle too. A missing frame must not hang the section forever;
        // draw() skips it and the rotation holds the previous frame instead.
        img.onload = settle;
        img.onerror = settle;
        img.decoding = "async";
        img.src = FRAME_SRC(i);
        images[i] = img;
      }
    };

    // Start early but not at first paint: the hero video owns the opening
    // bandwidth. One and a half viewports of warning is enough to finish
    // roughly 280KB before the pin engages.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        load();
      },
      { rootMargin: "150% 0px" }
    );
    io.observe(section);

    return () => {
      cancelled = true;
      io.disconnect();
      images.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [reduced]);

  /* --------------------------------------------------- pin and scrub */

  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    if (!section) return;

    // Deliberately NOT gated on the preload finishing.
    //
    // This pin inserts a spacer almost two viewports tall. Waiting for sixty
    // frames to download before creating it meant that spacer appeared long
    // after the page had been measured, and every pinned section below it kept
    // a start position that was now 1575px too high. The visible result was
    // the next section pinning early and sitting on top of copy that had not
    // scrolled away yet. Page geometry cannot depend on asset loading, so the
    // trigger is created on mount and the frames arrive whenever they arrive.
    // draw() skips a frame that has not loaded, and the progress readout is
    // covering the canvas until they are all in.
    draw(0);

    let dispose = () => {};
    let disposed = false;

    (async () => {
      // Dynamic so GSAP and ScrollTrigger stay out of the first paint graph.
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      // useReducedMotion cannot know the answer until after mount, so this
      // effect can start with motion allowed and then have the reduced motion
      // tree swap the trigger out from under it while the dynamic import is
      // still in flight. Pinning a node that is no longer in the document
      // throws inside GSAP when it tries to insert its spacer, which is a
      // WebKit visible page error. Check the node is still attached.
      if (disposed || !section.isConnected) return;

      const state = { frame: 0 };
      const tween = gsap.to(state, {
        frame: FRAME_COUNT - 1,
        ease: "none",
        onUpdate: () => {
          const i = Math.round(state.frame);
          if (i !== drawnRef.current) draw(i);
        },
      });

      const st = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        // A function so the distance is remeasured on refresh rather than
        // frozen at whatever the viewport was on mount.
        end: () => "+=" + window.innerHeight * SCROLL_VH,
        pin: true,
        // Pinning a full viewport panel jumps if the pin is applied late, so
        // let ScrollTrigger apply it a frame early on fast scrolls.
        anticipatePin: 1,
        scrub: true,
        animation: tween,
        invalidateOnRefresh: true,
      });

      // Sections above this one settle their own media after we mount, which
      // moves our start position. One refresh once we are live corrects it.
      ScrollTrigger.refresh();

      dispose = () => {
        st.kill(true); // true reverts the pin and its spacer
        tween.kill();
      };
    })();

    return () => {
      disposed = true;
      dispose();
    };
  }, [reduced, draw]);

  /* --------------------------------------------------------------- render */

  if (reduced) {
    // No pin, no scrub, no sixty frame download. The last frame is the one the
    // whole rotation exists to arrive at, so it is the one that stands alone.
    return (
      <section id="scrub" aria-labelledby={HEADING_ID} className="section bg-ink">
        <div className="shell grid12 items-center gap-y-12">
          <div className="col-span-12 lg:col-span-5">
            <p className="t-mono text-fog">{eartip.eyebrow}</p>
            <h2
              id={HEADING_ID}
              className="t-h1 mt-6 text-paper"
              style={{ fontSize: "clamp(2.25rem, 3.2vw, 3rem)" }}
            >
              {eartip.headlineLines.join(" ")}
            </h2>
            <div className="mt-8 flex max-w-[46ch] flex-col gap-5">
              {eartip.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-mist">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
          <div className="col-span-12 lg:col-span-6 lg:col-start-7">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              id={FIGURE_ID}
              src={FRAME_SRC(FRAME_COUNT - 1)}
              width={FRAME_W}
              height={FRAME_H}
              alt={STILL_ALT}
              className="h-auto w-full"
              style={{
                WebkitMaskImage: EDGE_FADE,
                maskImage: EDGE_FADE,
              }}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id="scrub"
      aria-labelledby={HEADING_ID}
      className="relative bg-ink"
    >
      <div className="relative h-svh w-full overflow-hidden">
        <div className="shell flex h-full flex-col justify-center">
          <div className="grid12 w-full items-center gap-y-8">
            {/* The rotation on its own filled a whole viewport and said
                nothing. It is the only place on the page that shows the
                sensor, so it gets a heading that explains why it is in an
                eartip and not somewhere more conspicuous. */}
            <div className="col-span-12 lg:col-span-5">
              <Reveal as="p" className="t-mono text-fog">
                {eartip.eyebrow}
              </Reveal>
              <MaskHeadline
                id={HEADING_ID}
                lines={eartip.headlineLines}
                className="t-h1 mt-6 text-paper"
                style={{ fontSize: "clamp(2.25rem, 3.2vw, 3rem)" }}
              />
              <Reveal
                className="mt-8 flex max-w-[46ch] flex-col gap-5 lg:mt-10"
                staggerChildren={60}
              >
                {eartip.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-mist">
                    {paragraph}
                  </p>
                ))}
              </Reveal>
            </div>

            <div className="relative col-span-12 aspect-[1000/562] lg:col-span-7 lg:col-start-6">
              <canvas
                ref={canvasRef}
                id={FIGURE_ID}
                role="img"
                aria-label={eartip.figureAlt}
                className="absolute inset-0 h-full w-full"
                style={{
                  WebkitMaskImage: EDGE_FADE,
                  maskImage: EDGE_FADE,
                }}
              />

              {/* Honest determinate progress: a real count of settled frames
                  and a bar driven by the same number. Never amber, this is not
                  the attended element, it is the section admitting it is not
                  ready. */}
              <div
                aria-hidden="true"
                className={
                  "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 " +
                  "transition-opacity duration-[240ms] [transition-timing-function:var(--ease-out-att)] " +
                  (ready ? "opacity-0" : "opacity-100")
                }
              >
                <div className="t-mono text-fog tabular-nums">
                  {settled} / {FRAME_COUNT}
                </div>
                <div className="h-px w-40 bg-[var(--hairline)]">
                  <div
                    className="h-full bg-mist"
                    style={{
                      width: `${(settled / FRAME_COUNT) * 100}%`,
                      transition: "width var(--d-fast) var(--ease-out-att)",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
