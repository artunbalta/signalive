"use client";

import { useEffect, useState } from "react";
import { LevelMeter } from "@/components/ui/Readout";
import type { MicInput } from "@/lib/audio/mic";

/** Level meter that follows a microphone at display rate. */
export function LiveLevel({ mic, active, label }: { mic: MicInput | null; active: boolean; label: string }) {
  const [level, setLevel] = useState({ rmsDb: -Infinity, peakDb: -Infinity });
  useEffect(() => {
    if (!mic) return;
    let raf = 0;
    const tick = () => {
      setLevel({ ...mic.level });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mic]);
  return <LevelMeter db={level.rmsDb} peakDb={level.peakDb} live={active} label={label} />;
}
