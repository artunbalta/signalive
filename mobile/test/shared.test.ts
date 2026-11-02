import { describe, expect, it } from "vitest";
import { NativeBridgeTransport } from "../../lib/sense/native-bridge";
import * as pageSide from "../../lib/sense/native-protocol";
import { decodeCommand, encodeCommand, encodeFrame, type Side, type SspFrame } from "../../lib/sense/protocol";
import * as protocol from "../../lib/sense/protocol";
import * as shellSide from "../src/shared";
import { connected } from "./harness";

const helloFrame = (side: Side) =>
  encodeFrame({
    type: "hello",
    side,
    seq: 0,
    timestamp: 0,
    flags: 0,
    firmware: [0, 1, 0],
    deviceId: "0011223344556677",
    labels: ["E1", "E2", "E3", "E4"],
    eegRate: 250,
    nvPerLsb: 22.35,
    imuRate: 100,
    battery: 77,
  } as SspFrame);

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("one bridge definition for page and shell", () => {
  it("is the very module the page uses, not a copy", () => {
    expect(shellSide.validateParams).toBe(pageSide.validateParams);
    expect(shellSide.NATIVE_CHANNEL).toBe(pageSide.NATIVE_CHANNEL);
    expect(shellSide.NativeBridgeError).toBe(pageSide.NativeBridgeError);
    expect(shellSide.SSP_SERVICE_UUID).toBe(protocol.SSP_SERVICE_UUID);
    expect(shellSide.SSP_FRAMES_UUID).toBe(protocol.SSP_FRAMES_UUID);
    expect(shellSide.SSP_COMMANDS_UUID).toBe(protocol.SSP_COMMANDS_UUID);
  });
});

describe("lib/sense's NativeBridgeTransport over the real injected bridge", () => {
  it("finds both earbuds, learns their sides and steers one, through page, router and outbox", async () => {
    const sideOf: Record<string, Side> = { "AA:01": "right", "AA:02": "left" };
    const written: [string, string][] = [];
    const disconnected: string[] = [];
    const { page, host } = connected(
      {
        "ble.scan": () => [
          { id: "AA:02", name: "Signalive", rssi: -61 },
          { id: "AA:01", name: "Signalive", rssi: -48 },
          { id: "FF:00", name: "Someone's", rssi: -90 },
        ],
        "ble.connect": ({ id }) => {
          host.emit("ble.state", { id, state: "connected", reason: null });
          return { id, name: "Signalive", mtu: 247 };
        },
        "ble.write": ({ id, bytes }) => {
          const command = decodeCommand(pageSide.decodeBase64(bytes)!)!.command;
          written.push([id, command.op]);
          // An earbud answers HELLO with its own, through a notification.
          if (command.op === "hello") host.emit("ble.bytes", { id, bytes: pageSide.encodeBase64(helloFrame(sideOf[id])) });
          return null;
        },
        "ble.disconnect": ({ id }) => {
          disconnected.push(id);
          return null;
        },
      },
      { auto: true },
    );

    const named: Side[] = [];
    const delivered: Side[] = [];
    const transport = new NativeBridgeTransport({ bridge: page.api, onSide: (s) => named.push(s) });
    await transport.connect((_bytes, side) => delivered.push(side));
    await settle();

    expect(written).toEqual([
      ["AA:01", "hello"],
      ["AA:01", "start"],
      ["AA:02", "hello"],
      ["AA:02", "start"],
    ]);
    expect(named).toEqual(["right", "left"]);
    expect(delivered).toEqual(["right", "left"]);
    expect([...transport.sides].sort()).toEqual(["left", "right"]);

    await transport.send("left", encodeCommand({ op: "steer", azimuthDeg: -30, gainDb: 6 }, { side: "left" }));
    expect(written.at(-1)).toEqual(["AA:02", "steer"]);

    await transport.disconnect();
    expect(written.slice(-2).map(([, op]) => op)).toEqual(["stop", "stop"]);
    expect(disconnected.sort()).toEqual(["AA:01", "AA:02"]);
  });

  it("reports the shell's refusal the way the trial's error mapping reads it", async () => {
    const { page } = connected(
      {
        "ble.scan": () => {
          throw new pageSide.NativeBridgeError("bluetooth_unauthorized", "Bluetooth is not allowed for this app in Settings");
        },
      },
      { auto: true },
    );
    const err = await new NativeBridgeTransport({ bridge: page.api }).connect(() => undefined).catch((e: unknown) => e);
    // trial/lib/extensions/signalive-provider.ts maps NotAllowedError to "blocked".
    expect(err).toMatchObject({ name: "NotAllowedError", code: "bluetooth_unauthorized" });
  });
});
