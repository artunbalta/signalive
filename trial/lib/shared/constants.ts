/** Bump when the consent text changes; returning users see the new version. */
export const CONSENT_VERSION = "2026-10-21";

/** Bump when lib/shared/lab/phrases.ts changes, so results never mix sets. */
export const PHRASE_SET_VERSION = "v1";

/** "Mark this moment" tags this much time before the tap. */
export const MARK_WINDOW_MS = 60_000;

/** The recorder makes notes after this many new utterances, or this much time. */
export const NOTES_BATCH_UTTERANCES = 8;
export const NOTES_BATCH_MS = 5 * 60_000;

/** One recorder utterance is cut here even if the speaker does not pause. */
export const MAX_SEGMENT_MS = 30_000;

/** Lab takes longer than this are rejected (the phrases take a few seconds). */
export const MAX_LAB_TAKE_MS = 20_000;

/** Rewind keeps this many seconds of microphone audio, in the browser's memory only. */
export const REWIND_BUFFER_SEC = 30;
/** How far back a rewind can go; the first is the default. */
export const REWIND_LENGTHS = [15, 10, 30] as const;
