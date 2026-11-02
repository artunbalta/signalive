"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { detectPlatform } from "@/lib/client/platform";
import { useStore } from "@/lib/client/store";
import { installState, promptInstall } from "./install";

/**
 * Settings: put Signalive on the home screen. A button where the browser
 * offers installing, the Share menu's steps on iPhone and iPad, and a short
 * pointer to the browser's menu everywhere else.
 */
export function InstallCard() {
  const { m } = useI18n();
  const s = useStore(installState);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setIos(detectPlatform().isIOS), []);

  return (
    <Card>
      <SectionTitle title={m.pwa.title} />
      <p className="text-[0.92rem] leading-relaxed text-mist">{m.pwa.body}</p>
      <div className="mt-4">
        {s.installed ? (
          <p className="flex items-center gap-2 text-[0.95rem]">
            <Icon name="check" size={18} />
            {m.pwa.installed}
          </p>
        ) : s.prompt ? (
          <Button
            variant="primary"
            icon="download"
            busy={busy}
            onClick={() => {
              setBusy(true);
              void promptInstall().finally(() => setBusy(false));
            }}
          >
            {m.pwa.install}
          </Button>
        ) : (
          <p className="flex items-start gap-2.5 text-[0.92rem] leading-relaxed">
            <Icon name="share" size={18} className="mt-0.5 text-mist" />
            {ios ? m.pwa.ios : m.pwa.other}
          </p>
        )}
      </div>
    </Card>
  );
}
