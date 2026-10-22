"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { DevicesStep } from "./DevicesStep";
import { FirstReplyStep } from "./FirstReplyStep";
import { MicCheckStep } from "./MicCheckStep";
import { WindStep } from "./WindStep";

const STEPS = ["devices", "mic", "wind", "first"] as const;
type Step = (typeof STEPS)[number];

export function SetupWizard() {
  const { m, f } = useI18n();
  const [step, setStep] = useState<Step>("devices");
  const index = STEPS.indexOf(step);
  const go = (delta: number) => {
    setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, index + delta))]!);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-[720px]">
      <p className="t-label">{f(m.setup.stepOf, { n: index + 1, total: STEPS.length })}</p>
      <h1 className="t-display mt-2 text-[clamp(1.9rem,5vw,2.6rem)]">{m.setup.title}</h1>
      <ol className="mt-5 mb-7 grid grid-cols-4 gap-2" aria-label={m.setup.title}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={s === step ? "step" : undefined}>
            <div className={`h-[3px] rounded-full ${i < index ? "bg-paper/70" : i === index ? "bg-paper" : "bg-[var(--hairline-strong)]"}`} />
            <p className={`mt-2 truncate text-[0.78rem] ${i === index ? "text-paper" : "text-fog"}`}>{m.setup.steps[s]}</p>
          </li>
        ))}
      </ol>
      {step === "devices" ? <DevicesStep onNext={() => go(1)} /> : null}
      {step === "mic" ? <MicCheckStep onNext={() => go(1)} onBack={() => go(-1)} /> : null}
      {step === "wind" ? <WindStep onNext={() => go(1)} onBack={() => go(-1)} /> : null}
      {step === "first" ? <FirstReplyStep onBack={() => go(-1)} /> : null}
    </div>
  );
}
