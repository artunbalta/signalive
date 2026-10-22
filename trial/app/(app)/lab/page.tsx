"use client";

import { useEffect } from "react";
import { LabRunner } from "@/components/lab/LabRunner";
import { LabSetupForm } from "@/components/lab/LabSetupForm";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { lab } from "@/lib/client/lab";
import { useStore } from "@/lib/client/store";

export default function LabPage() {
  const { m } = useI18n();
  const config = useConfig();
  const v = useStore(lab.view);
  useEffect(() => lab.configure(config), [config]);
  const setup = v.stage === "setup" || v.stage === "starting";
  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <header>
        <h1 className="t-display text-[1.9rem]">{m.lab.title}</h1>
        {setup ? <p className="mt-2 max-w-2xl text-mist">{m.lab.lead}</p> : null}
      </header>
      {setup ? <LabSetupForm /> : <LabRunner />}
    </div>
  );
}
