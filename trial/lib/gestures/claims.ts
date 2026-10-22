import type { Command, GestureType } from "./types";

/**
 * A screen that is live can take a gesture over for as long as it runs: on
 * Focus the jaw clench locks the voice you face instead of rewinding. The
 * user's own binding applies again when the claim is released.
 */
const claims = new Map<GestureType, Command>();

export function claimGesture(type: GestureType, cmd: Command): () => void {
  claims.set(type, cmd);
  return () => {
    if (claims.get(type) === cmd) claims.delete(type);
  };
}

export function claimedCommand(type: GestureType): Command | undefined {
  return claims.get(type);
}
