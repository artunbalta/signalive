"use client";

import { Button } from "@/components/ui/Button";
import { useI18n } from "@/components/providers/AppProviders";
import { earbuds } from "@/lib/client/earbuds";

/**
 * The visitor acts as the simulated earbuds: a clench puts jaw muscle
 * activity on every electrode of both, a head turn moves their motion
 * sensors. What follows is the real path: the clench detector, the gesture
 * bus, the bound command, the head tracker.
 */
export function SimulatedEarbuds() {
  const { m } = useI18n();
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => earbuds.clench("single")}>{m.earbuds.clenchOnce}</Button>
      <Button onClick={() => earbuds.clench("double")}>{m.earbuds.clenchTwice}</Button>
      <Button icon="arrow" onClick={() => earbuds.turnHead()}>
        {m.earbuds.turnHead}
      </Button>
    </div>
  );
}
