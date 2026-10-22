import { nullAttentionProvider, type AttentionSignalProvider } from "@/lib/extensions/attention-provider";

/**
 * Per-source gain stage between everything the app plays and the master
 * output. Today the only source is the assistant's voice. It is also the
 * insertion point for attention decoding: register separated sources here
 * and let applyAttention() weight them by what the wearer attends to.
 */
export class SourceStage {
  private readonly gains = new Map<string, GainNode>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
    private attention: AttentionSignalProvider = nullAttentionProvider,
  ) {}

  /** The node a source should connect to. Created on first use. */
  input(sourceId: string): GainNode {
    let g = this.gains.get(sourceId);
    if (!g) {
      g = this.ctx.createGain();
      g.connect(this.destination);
      this.gains.set(sourceId, g);
    }
    return g;
  }

  setGain(sourceId: string, gain: number, rampSeconds = 0.05) {
    const g = this.input(sourceId);
    g.gain.setTargetAtTime(gain, this.ctx.currentTime, rampSeconds / 3);
  }

  setAttentionProvider(p: AttentionSignalProvider) {
    this.attention = p;
  }

  /**
   * Weights sources by the attention signal. With the null provider this
   * does nothing. boostDb and cutDb are deliberately conservative defaults.
   * `among` limits it to some sources (the app's own voices stay as they
   * are); with `neutralDb`, no confident decision sets them all to it.
   * Returns the source that was raised, if any.
   */
  applyAttention({
    boostDb = 6,
    cutDb = -6,
    minConfidence = 0.7,
    among,
    neutralDb,
  }: { boostDb?: number; cutDb?: number; minConfidence?: number; among?: readonly string[]; neutralDb?: number } = {}): string | null {
    const ids = among ?? [...this.gains.keys()];
    const attended = this.attention.currentAttendedSource();
    if (!attended || attended.confidence < minConfidence || !ids.includes(attended.sourceId)) {
      if (neutralDb !== undefined) for (const id of ids) this.setGain(id, 10 ** (neutralDb / 20), 0.3);
      return null;
    }
    for (const id of ids) {
      const db = id === attended.sourceId ? boostDb : cutDb;
      this.setGain(id, 10 ** (db / 20), 0.2);
    }
    return attended.sourceId;
  }

  sources(): string[] {
    return [...this.gains.keys()];
  }
}
