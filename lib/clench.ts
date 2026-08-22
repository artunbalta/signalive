/**
 * The measured jaw clench in /media/gesture.mp4.
 *
 * Found by extracting all 192 frames at 540x960, tracking head translation
 * frame to frame with the earbud as a template (the subject drifts up to 41px
 * vertically, so naive frame differencing just measures that drift), then
 * taking the peak mean absolute difference over the masseter region sampled at
 * the tracked offset. Frame 69 of 192 at 24fps, and the strongest event in the
 * clip at 2.84x the mean both before and after motion compensation.
 *
 * The amber pulse in the pinned scene keys off this, and so does the beat that
 * narrates it. If a human watching the footage prefers a different frame, this
 * is the only number to change.
 */
export const CLENCH_TIME = 2.83;

/**
 * How long before the clench the video is cued when its beat arrives, so the
 * line lands, then the jaw moves. Seeking once is reliable everywhere, where
 * continuously scrubbing a video is not, especially in Safari.
 */
export const CLENCH_LEAD = 0.45;

/**
 * Where the earbud sits inside the video frame, as a fraction of the video's
 * own intrinsic 720x1280. Used to place the pulse ring. These are fractions of
 * the VIDEO CONTENT, not of whatever box it is cropped into, so anything using
 * them has to position itself against the content box.
 */
export const EAR_X = 0.76;
export const EAR_Y = 0.15;

/** The video's intrinsic aspect, needed to rebuild the cover box in CSS. */
export const VIDEO_ASPECT = 9 / 16;
