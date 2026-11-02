import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { tr } from "@/lib/i18n/messages/tr";
import {
  asMoment,
  MemoryBackend,
  MomentsStore,
  momentsToJson,
  momentsToMarkdown,
  openDefaultBackend,
  type MomentsBackend,
} from "@/lib/client/moments-store";
import type { AgentAction, Moment } from "@/lib/shared/moments";

function moment(over: Partial<Moment> = {}): Moment {
  return {
    id: over.id ?? crypto.randomUUID(),
    createdAt: "2026-11-02T10:00:00.000Z",
    timeZone: "Europe/Istanbul",
    place: null,
    trigger: "clench",
    seconds: 30,
    transcript: "Ayşe, can you send the deck by Friday?",
    title: "Launch deck",
    summary: "Ayşe sends the deck by Friday.",
    keyPoints: ["The deck is due Friday"],
    actionItems: [{ text: "Ayşe sends the deck", due: "2026-11-06T15:00:00+03:00" }],
    people: ["Ayşe"],
    topics: ["launch"],
    language: "en",
    actions: [],
    pinned: false,
    ...over,
  };
}

const store = (backend: MomentsBackend = new MemoryBackend()) => new MomentsStore(async () => backend);

describe("moments store", () => {
  it("lists newest first, and finds, updates and removes one", async () => {
    const s = store();
    await s.load();
    expect(s.get()).toMatchObject({ storage: "memory", moments: [] });
    const older = moment({ id: "a", createdAt: "2026-11-01T09:00:00.000Z" });
    const newer = moment({ id: "b", createdAt: "2026-11-02T09:00:00.000Z" });
    await s.add(older);
    await s.add(newer);
    expect(s.get().moments.map((m) => m.id)).toEqual(["b", "a"]);
    expect(s.find("a")?.createdAt).toBe(older.createdAt);

    const updated = await s.update("a", (m) => ({ ...m, title: "Renamed", pinned: true }));
    expect(updated).toMatchObject({ id: "a", title: "Renamed", pinned: true });
    expect(s.find("a")?.title).toBe("Renamed");
    // A change hands back a new object; the snapshot before it is untouched.
    expect(older.title).toBe("Launch deck");
    expect(await s.update("missing", (m) => m)).toBeNull();

    await s.remove("b");
    expect(s.get().moments.map((m) => m.id)).toEqual(["a"]);
    await s.clear();
    expect(s.get().moments).toEqual([]);
  });

  it("keeps what it holds in the backend, so a new page reads it back", async () => {
    const backend = new MemoryBackend();
    const first = store(backend);
    await first.load();
    await first.add(moment({ id: "kept" }));
    const second = store(backend);
    await second.load();
    expect(second.get().moments.map((m) => m.id)).toEqual(["kept"]);
  });

  it("writes a moment added before storage opened once it opens", async () => {
    const backend = new MemoryBackend();
    const s = store(backend);
    await s.add(moment({ id: "early" }));
    expect(await backend.all()).toEqual([]);
    await s.load();
    expect((await backend.all()).map((m) => m.id)).toEqual(["early"]);
    expect(s.get().moments.map((m) => m.id)).toEqual(["early"]);
  });

  it("adds an action to its moment, then replaces it by id", async () => {
    const s = store();
    await s.load();
    await s.add(moment({ id: "m" }));
    const action: AgentAction = {
      kind: "reminder",
      text: "Call the venue",
      due: null,
      id: "act",
      momentId: "m",
      createdAt: "2026-11-02T10:01:00.000Z",
      status: "proposed",
    };
    await s.putAction("m", action);
    await s.putAction("m", { ...action, status: "accepted" });
    expect(s.find("m")?.actions).toEqual([{ ...action, status: "accepted" }]);
  });

  it("says when the device would not save, keeps the change, and clears the flag once a write works", async () => {
    let fail = true;
    const inner = new MemoryBackend();
    const flaky: MomentsBackend = {
      kind: "indexeddb",
      all: () => inner.all(),
      put: async (m) => {
        if (fail) throw new Error("QuotaExceededError");
        await inner.put(m);
      },
      delete: (id) => inner.delete(id),
      clear: () => inner.clear(),
    };
    const s = store(flaky);
    await s.load();
    await s.add(moment({ id: "x" }));
    expect(s.get()).toMatchObject({ storage: "indexeddb", writeFailed: true });
    expect(s.find("x")).toBeTruthy();
    fail = false;
    await s.add(moment({ id: "y" }));
    expect(s.get().writeFailed).toBe(false);
  });

  it("falls back to memory when IndexedDB is missing, refused, or fails to open", async () => {
    expect((await openDefaultBackend(undefined)).kind).toBe("memory");
    const throwing = { open: () => { throw new DOMException("denied", "SecurityError"); } } as unknown as IDBFactory;
    expect((await openDefaultBackend(throwing)).kind).toBe("memory");
    const failing = {
      open: () => {
        const req: { error: unknown; onerror?: () => void } = { error: new DOMException("broken", "UnknownError") };
        setTimeout(() => req.onerror?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    expect((await openDefaultBackend(failing)).kind).toBe("memory");
    // A store whose backend cannot open at all still works, in memory.
    const s = new MomentsStore(() => Promise.reject(new Error("no")));
    await s.load();
    expect(s.get().storage).toBe("memory");
  });

  it("reads only records that are moments, and fills what older ones lack", () => {
    expect(asMoment(null)).toBeNull();
    expect(asMoment({ id: 1, createdAt: "2026-11-02T10:00:00Z" })).toBeNull();
    expect(asMoment({ id: "a", createdAt: "not a date" })).toBeNull();
    const partial = asMoment({ id: "a", createdAt: "2026-11-02T10:00:00Z", title: "T", actionItems: [{ text: "Do it" }, { nope: 1 }] });
    expect(partial).toMatchObject({
      id: "a",
      title: "T",
      keyPoints: [],
      people: [],
      topics: [],
      actions: [],
      actionItems: [{ text: "Do it", due: null }],
      trigger: "button",
      place: null,
      language: "en",
      pinned: false,
    });
  });
});

describe("moments exports", () => {
  const a = moment({ id: "a", createdAt: "2026-11-01T09:00:00.000Z", title: "First", place: { name: "Moda, Kadıköy", lat: 40.98, lon: 29.03 } });
  const b = moment({ id: "b", createdAt: "2026-11-02T09:00:00.000Z", title: "Second", transcript: "Line one\nLine two" });

  it("exports every field as JSON", () => {
    const parsed = JSON.parse(momentsToJson([b, a], new Date("2026-11-02T12:00:00Z"))) as { kind: string; exportedAt: string; moments: Moment[] };
    expect(parsed.kind).toBe("moments");
    expect(parsed.exportedAt).toBe("2026-11-02T12:00:00.000Z");
    expect(parsed.moments).toEqual([b, a]);
  });

  it("exports readable Markdown, oldest first, in the interface language", () => {
    const md = momentsToMarkdown([b, a], { messages: en, locale: "en", now: new Date("2026-11-02T12:00:00Z") });
    expect(md.startsWith("# Signalive moments\n")).toBe(true);
    expect(md).toContain("2 moments, kept on this device.");
    expect(md.indexOf("## First")).toBeLessThan(md.indexOf("## Second"));
    expect(md).toContain("· Moda, Kadıköy");
    expect(md).toContain("### Key points\n\n- The deck is due Friday");
    expect(md).toMatch(/- \[ \] Ayşe sends the deck \(Due .*6 Nov.*\)/);
    expect(md).toContain("People: Ayşe");
    expect(md).toContain("> Line one\n> Line two");

    const trMd = momentsToMarkdown([a], { messages: tr, locale: "tr", now: new Date("2026-11-02T12:00:00Z") });
    expect(trMd).toContain("# Signalive anları");
    expect(trMd).toContain("### Öne çıkanlar");
    expect(trMd).toContain("### Yapılacaklar");
    expect(trMd).toContain("Bu cihazda tutulan 1 an.");
  });
});
