/**
 * Extension point: auditory attention decoding.
 *
 * A later Signalive version decodes which sound source the wearer is
 * attending to (from in-ear or around-ear sensors) and boosts it. This
 * interface is where that decoder plugs in. The web trial decodes nothing:
 * the stub below never reports a source, and the Focus screen's provider
 * (lib/client/focus.ts) reports the voice the head is turned to, a stand-in
 * that exercises the same path.
 *
 * The audio graph already has the hook it would drive: every sound the app
 * plays goes through a per-source gain stage (lib/audio/source-stage.ts).
 * With a real provider, separated sources from the microphone (each speaker
 * around the wearer) would be registered there as well, and
 * SourceStage.applyAttention() would raise the attended source and lower the
 * rest.
 */

export interface AttendedSource {
  /** Matches an id registered with the SourceStage. */
  sourceId: string;
  /** 0..1, the decoder's confidence over its decision window. */
  confidence: number;
}

export interface AttentionSignalProvider {
  readonly id: string;
  currentAttendedSource(): AttendedSource | null;
}

/** The only provider in v0: attention is never decoded. */
export const nullAttentionProvider: AttentionSignalProvider = {
  id: "none",
  currentAttendedSource: () => null,
};
