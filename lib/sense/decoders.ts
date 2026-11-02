/**
 * Either attention decoder behind one door: the linear one (model version 1,
 * research/aad/export.py) or the learned one (version 2,
 * research/aad/deep_export.py). The session takes whichever model it is
 * given and asks only what both answer.
 */
import { AttentionDecoder, type DecoderModel, type DecoderOptions } from "./decoder";
import { DEFAULT_EEG_WEIGHT } from "./fusion";
import { NeuralAttentionDecoder, type NeuralDecoderModel } from "./neural";

export type AnyDecoderModel = DecoderModel | NeuralDecoderModel;
export type StreamingDecoder = AttentionDecoder | NeuralAttentionDecoder;

export function createDecoder(model: AnyDecoderModel, talkers: number, opts: DecoderOptions = {}): StreamingDecoder {
  return model.version === 2 ? new NeuralAttentionDecoder(model, talkers, opts) : new AttentionDecoder(model, talkers, opts);
}

/** Log odds per unit of margin a decision from this model deserves: its own fitted weight, else the fusion default (fitted for the linear decoder). */
export function fusionWeight(model: AnyDecoderModel): number {
  const w = model.eegWeight;
  return typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : DEFAULT_EEG_WEIGHT;
}
