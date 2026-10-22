"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { currentToken } from "@/lib/client/auth";
import { getPrefs, markLanding } from "@/lib/client/prefs";

/**
 * The one primary action. Returning visitors who already agreed to the
 * current consent text skip it; everyone else goes through consent first.
 */
export function StartButton() {
  const { m } = useI18n();
  const config = useConfig();
  const router = useRouter();
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    markLanding();
    void currentToken().then((t) => {
      setReturning(!!t && getPrefs().consentVersion === config.consentVersion);
    });
  }, [config.consentVersion]);

  const go = () => {
    if (!returning) return router.push("/consent");
    router.push(getPrefs().setupDone ? "/assistant" : "/setup");
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="primary" size="lg" iconRight="arrow" onClick={go} className="px-8">
        {m.landing.cta}
      </Button>
      {returning ? <p className="text-[0.88rem] text-mist">{m.landing.resume}</p> : null}
    </div>
  );
}
