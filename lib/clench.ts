/**
 * The measured double jaw clench in /media/gesture.mp4.
 *
 * Found by extracting all 192 frames at 540x960, tracking head translation
 * frame to frame with the earbud as a template (the subject drifts up to 53px
 * vertically, so naive frame differencing just measures that drift), then
 * taking the mean absolute difference over the masseter region sampled at the
 * tracked offset, against the same over the temple: a clench moves the jaw
 * more than the temple, a movement of the head moves both. The two strongest
 * jaw events, frames 119 and 132 of 192 at 24fps (2.3x and 3.4x the mean), are
 * the two clenches, 0.54s apart; a peak at 3.0s that moved the temple more
 * than the jaw is the head. .assetgen/measure_clench.py repeats this.
 *
 * The amber ring in the pinned scene pulses at each, and the beat that
 * narrates them keys off the first. If a human watching the footage prefers
 * different frames, these are the only numbers to change.
 */
export const CLENCH_TIMES = [4.96, 5.5];

/** The first clench, where the beat cues the footage. */
export const CLENCH_TIME = CLENCH_TIMES[0];

/**
 * How long before the clench the video is cued when its beat arrives, so the
 * line lands, then the jaw moves. Seeking once is reliable everywhere, where
 * continuously scrubbing a video is not, especially in Safari.
 */
export const CLENCH_LEAD = 0.45;

/**
 * Where the earbud sits inside the video frame at the clench, as a fraction of
 * the video's own intrinsic 720x1280 (frame 125, between the two, which is
 * also the poster). Used to place the pulse ring. These are fractions of the
 * VIDEO CONTENT, not of whatever box it is cropped into, so anything using
 * them has to position itself against the content box.
 */
export const EAR_X = 0.73;
export const EAR_Y = 0.18;

/** The video's intrinsic aspect, needed to rebuild the cover box in CSS. */
export const VIDEO_ASPECT = 9 / 16;
