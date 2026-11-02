"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { Callout, Card, SectionTitle } from "@/components/ui/Card";
import { ReadoutRows } from "@/components/ui/Readout";
import { NATIVE_GLOBAL, NATIVE_USER_AGENT_TOKEN } from "@sense/native-protocol";
import { earbuds } from "@/lib/client/earbuds";
import { getPrefs } from "@/lib/client/prefs";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";
import type { EarbudState, SignaliveTransport } from "@/lib/extensions/signalive-provider";
import { gestureBus } from "@/lib/gestures/bus";
import { claimedCommand } from "@/lib/gestures/claims";
import { DEFAULT_BINDINGS, type Command, type GestureType } from "@/lib/gestures/types";
import { SimulatedEarbuds } from "./SimulatedEarbuds";

const TRANSPORTS: SignaliveTransport[] = ["simulated", "bluetooth", "cyton"];
const SIDES = ["left", "right", "single"] as const;

/**
 * Settings: connect Signalive earbuds, their simulation or an OpenBCI board,
 * and watch what comes in. Nothing connects until a button is pressed,
 * Bluetooth and USB are offered only where the browser has them, and the
 * earbuds stay connected across screens until Disconnect.
 */
export function EarbudsCard() {
  const { m, f } = useI18n();
  const v = useStore(earbuds.view);
  const r = useStore(rewind.view);
  const [support, setSupport] = useState<Record<SignaliveTransport, boolean> | null>(null);
  const [last, setLast] = useState<{ type: GestureType; command: Command } | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { bluetooth?: unknown; serial?: unknown };
    // Inside the Signalive app (mobile/), its own Bluetooth stands in for the browser's.
    const app = NATIVE_GLOBAL in window || navigator.userAgent.includes(`${NATIVE_USER_AGENT_TOKEN}/`);
    setSupport({ simulated: true, bluetooth: Boolean(nav.bluetooth) || app, cyton: Boolean(nav.serial) });
    // Fetched now, so a device chooser opens within the tap that asks for it.
    earbuds.preload().catch(() => undefined);
  }, []);

  // What the app did with the earbuds' last gesture, decided as the command router decides it.
  useEffect(() => {
    const off = gestureBus.subscribe((e) => {
      if (e.source !== "sensor") return;
      const bindings = { ...DEFAULT_BINDINGS, ...(getPrefs().gestureBindings ?? {}) };
      setLast({ type: e.type, command: claimedCommand(e.type) ?? bindings[e.type] });
    });
    return () => {
      off();
    };
  }, []);

  const connected = v.phase === "connected";
  const sides = SIDES.filter((s) => v.earbuds[s]);
  const yaw = (deg: number) =>
    deg === 0 ? m.earbuds.yawAhead : f(deg > 0 ? m.earbuds.yawRight : m.earbuds.yawLeft, { n: Math.abs(deg) });
  const contact = (b: EarbudState) =>
    b.labels.map((label, i) => `${label} ${(b.leadOff ?? 0) & (1 << i) ? m.earbuds.contactOff : m.earbuds.contactOk}`).join(", ");
  const rewindNote =
    last?.command !== "rewind"
      ? null
      : r.error === "rewind_off" || r.error === "rewind_empty"
        ? m.rewind.errors[r.error]
        : r.phase === "clench" || r.phase === "rewinding" || r.phase === "replaying" || r.phase === "narrating"
          ? f(m.rewind.phases[r.phase], { n: Math.round(r.clipSeconds) })
          : null;

  return (
    <Card>
      <SectionTitle title={m.earbuds.title} />
      <p className="text-[0.92rem] leading-relaxed text-mist">{m.earbuds.lead}</p>

      {!connected ? (
        <ul className="mt-5 space-y-4">
          {TRANSPORTS.map((t) => (
            <li key={t} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              {support?.[t] === false ? (
                <p className="text-[0.88rem] leading-relaxed text-fog">
                  <span className="font-medium text-mist">{m.earbuds.transports[t]}.</span>{" "}
                  {t === "bluetooth" ? m.earbuds.noBluetooth : m.earbuds.noSerial}
                </p>
              ) : (
                <>
                  <Button
                    variant={t === "simulated" ? "primary" : "secondary"}
                    className="shrink-0 sm:w-[17rem]"
                    busy={v.phase === "connecting" && v.transport === t}
                    disabled={!support || v.phase === "connecting"}
                    onClick={() => void earbuds.connect(t)}
                  >
                    {v.phase === "connecting" && v.transport === t ? m.earbuds.connecting : m.earbuds.transports[t]}
                  </Button>
                  <p className="text-[0.88rem] leading-relaxed text-mist">{m.earbuds.hints[t]}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5 space-y-5">
          <ReadoutRows
            rows={[
              { label: m.earbuds.connection, value: v.transport ? m.earbuds.transports[v.transport] : "-" },
              ...sides.map((s) => {
                const battery = v.earbuds[s]!.battery;
                return { label: m.earbuds.sides[s], value: battery === null ? m.earbuds.batteryUnknown : f(m.earbuds.battery, { n: battery }) };
              }),
              { label: m.earbuds.frames, value: v.frames },
              { label: m.earbuds.lost, value: v.lost },
              ...(v.yaw === null ? [] : [{ label: m.earbuds.headYaw, value: yaw(v.yaw) }]),
              { label: m.earbuds.clench, value: v.listening ? m.earbuds.listening : m.earbuds.learning },
              ...sides
                .filter((s) => v.earbuds[s]!.leadOff !== null)
                .map((s) => ({ label: f(m.earbuds.contact, { side: m.earbuds.sides[s] }), value: contact(v.earbuds[s]!) })),
              ...(last
                ? [
                    {
                      label: m.earbuds.lastGesture,
                      value: f(m.earbuds.gestureRan, { gesture: m.gestures.gestureNames[last.type], command: m.gestures.commands[last.command] }),
                    },
                  ]
                : []),
            ]}
          />
          {rewindNote ? <Callout kind="info" title={rewindNote} /> : null}

          {v.transport === "bluetooth" && sides.length === 1 && sides[0] !== "single" ? (
            <div className="space-y-2">
              <Button onClick={() => void earbuds.addEarbud()}>{m.earbuds.addOther}</Button>
              <p className="text-[0.85rem] leading-relaxed text-fog">{m.earbuds.addOtherHint}</p>
            </div>
          ) : null}

          {v.transport === "simulated" ? (
            <div className="space-y-3 border-t border-[var(--hairline)] pt-5">
              <p className="font-medium">{m.earbuds.simulatedTitle}</p>
              <SimulatedEarbuds />
              <p className="text-[0.85rem] leading-relaxed text-fog">{m.earbuds.simulatedHint}</p>
            </div>
          ) : null}

          <div className="border-t border-[var(--hairline)] pt-5">
            <Button variant="ghost" icon="stop" onClick={() => void earbuds.disconnect()}>
              {m.earbuds.disconnect}
            </Button>
          </div>
        </div>
      )}

      {v.error && !connected ? (
        <div className="mt-4">
          <Callout kind="warn" title={m.earbuds.errors[v.error]} />
        </div>
      ) : null}
      <p className="mt-4 text-[0.85rem] leading-relaxed text-fog">{m.earbuds.privacy}</p>
    </Card>
  );
}
