import { z } from "zod";
import { json, readJson, requireUser, route } from "@/lib/server/http";
import { MEDIA_KEY_ACTIONS } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

const num = z.number().finite().nullable();
const MediaKey = z.object({ bound: z.boolean(), fired: z.number().int().min(0), lastFiredAt: z.string().nullable() });

const Body = z.object({
  id: z.string().uuid().optional(),
  sessionId: z.string().uuid(),
  inputLabel: z.string().max(200),
  outputLabel: z.string().max(200).nullable(),
  trackSampleRate: num,
  contextSampleRate: num,
  channelCount: num,
  browser: z.string().max(60),
  os: z.string().max(60),
  isMobile: z.boolean(),
  bluetoothSuspected: z.boolean(),
  handsFreeSuspected: z.boolean(),
  effectiveBandwidthHz: num,
  rmsDbfs: num,
  peakDbfs: num,
  noiseFloorDbfs: num,
  windLowFreqRatio: num,
  outputSelectable: z.boolean(),
  mediaKeys: z.partialRecord(z.enum(MEDIA_KEY_ACTIONS), MediaKey),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/** Creates this session's device profile, or updates it when id is given. */
export const POST = route("device-profile", async (req) => {
  const { store } = await requireUser(req);
  const { id, ...input } = await readJson(req, Body);
  const extra = input.extra ?? {};
  if (JSON.stringify(extra).length > 4000) return json({ error: "invalid_request" }, 400);
  const profile = await store.saveDeviceProfile({ ...input, extra }, id);
  return json(profile, id ? 200 : 201);
});
