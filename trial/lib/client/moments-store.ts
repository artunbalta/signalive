"use client";

import { useEffect, useSyncExternalStore } from "react";
import { format, type Locale, type Messages } from "@/lib/i18n";
import type { AgentAction, Moment, MomentPlace } from "@/lib/shared/moments";
import { formatDateTime, formatDue } from "./moments-format";

/**
 * Moments live on the device, in this browser's IndexedDB, and nowhere else:
 * the server writes a moment's content once and forgets it, and Ask sends a
 * few of them along with a question, never all of them. Where IndexedDB is
 * missing or refuses to open (some private windows, some embedded browsers),
 * moments are kept in memory for as long as the page is open, and the
 * screens say so.
 *
 * Reads come from a copy in memory, loaded once, so the feed renders
 * synchronously; writes go to that copy first and then to IndexedDB. Other
 * tabs hear about every write on a BroadcastChannel and reload.
 */

export type MomentsStorage = "loading" | "indexeddb" | "memory";

export interface MomentsSnapshot {
  storage: MomentsStorage;
  /** Newest first. */
  moments: readonly Moment[];
  /** A write to IndexedDB failed; the change is in memory only. */
  writeFailed: boolean;
}

export interface MomentsBackend {
  readonly kind: "indexeddb" | "memory";
  all(): Promise<Moment[]>;
  put(m: Moment): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

const clone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T));

/** Kept in the page's memory only. */
export class MemoryBackend implements MomentsBackend {
  readonly kind = "memory" as const;
  private readonly rows = new Map<string, Moment>();

  async all() {
    return [...this.rows.values()].map(clone);
  }
  async put(m: Moment) {
    this.rows.set(m.id, clone(m));
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async clear() {
    this.rows.clear();
  }
}

const DB_NAME = "signalive-moments";
const DB_VERSION = 1;
const STORE = "moments";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbBackend implements MomentsBackend {
  readonly kind = "indexeddb" as const;

  private constructor(private readonly db: IDBDatabase) {}

  /** Rejects when IndexedDB is refused, fails, or stays blocked longer than timeoutMs. */
  static open(factory: IDBFactory, timeoutMs = 4000): Promise<IdbBackend> {
    return new Promise((resolve, reject) => {
      let open: IDBOpenDBRequest;
      try {
        open = factory.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => reject(new Error("indexeddb_timeout")), timeoutMs);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" }).createIndex("createdAt", "createdAt");
        }
      };
      open.onsuccess = () => {
        clearTimeout(timer);
        const db = open.result;
        // A newer version elsewhere (another tab after an update) takes over.
        db.onversionchange = () => db.close();
        resolve(new IdbBackend(db));
      };
      open.onerror = () => {
        clearTimeout(timer);
        reject(open.error ?? new Error("indexeddb_failed"));
      };
    });
  }

  private write(fn: (s: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(STORE, "readwrite");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("indexeddb_abort"));
      fn(t.objectStore(STORE));
    });
  }

  async all() {
    return (await request(this.db.transaction(STORE, "readonly").objectStore(STORE).getAll())) as Moment[];
  }
  put(m: Moment) {
    return this.write((s) => s.put(m));
  }
  delete(id: string) {
    return this.write((s) => s.delete(id));
  }
  clear() {
    return this.write((s) => s.clear());
  }
}

/** IndexedDB when this browser has it and lets the app open it, else memory. */
export async function openDefaultBackend(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<MomentsBackend> {
  if (!factory) return new MemoryBackend();
  try {
    return await IdbBackend.open(factory);
  } catch {
    return new MemoryBackend();
  }
}

/* ---- Shape checks ------------------------------------------------------------ */

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function place(v: unknown): MomentPlace | null {
  const p = v as Partial<MomentPlace> | null;
  if (!p || typeof p !== "object" || typeof p.lat !== "number" || typeof p.lon !== "number") return null;
  return { name: typeof p.name === "string" ? p.name : "", lat: p.lat, lon: p.lon };
}

/**
 * A stored record as a Moment, or null when it is not one. Older or partial
 * records get empty lists instead of breaking the feed.
 */
export function asMoment(v: unknown): Moment | null {
  const r = v as Partial<Moment> | null;
  if (!r || typeof r !== "object" || typeof r.id !== "string" || typeof r.createdAt !== "string") return null;
  if (Number.isNaN(Date.parse(r.createdAt))) return null;
  return {
    id: r.id,
    createdAt: r.createdAt,
    timeZone: typeof r.timeZone === "string" ? r.timeZone : null,
    place: place(r.place),
    trigger: r.trigger === "clench" || r.trigger === "key" ? r.trigger : "button",
    seconds: typeof r.seconds === "number" ? r.seconds : 0,
    transcript: typeof r.transcript === "string" ? r.transcript : "",
    title: typeof r.title === "string" ? r.title : "",
    summary: typeof r.summary === "string" ? r.summary : "",
    keyPoints: strings(r.keyPoints),
    actionItems: Array.isArray(r.actionItems)
      ? r.actionItems
          .filter((a): a is { text: string; due: string | null } => !!a && typeof a.text === "string")
          .map((a) => ({ text: a.text, due: typeof a.due === "string" ? a.due : null }))
      : [],
    people: strings(r.people),
    topics: strings(r.topics),
    language: r.language === "tr" ? "tr" : "en",
    actions: Array.isArray(r.actions) ? (r.actions.filter((a) => !!a && typeof a === "object" && typeof a.id === "string") as AgentAction[]) : [],
    pinned: r.pinned === true,
  };
}

const newestFirst = (a: Moment, b: Moment) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/* ---- The store ----------------------------------------------------------------- */

const CHANNEL = "signalive-moments";
const EMPTY: MomentsSnapshot = { storage: "loading", moments: [], writeFailed: false };

export class MomentsStore {
  private snap: MomentsSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private backend: MomentsBackend | null = null;
  private loading: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly openBackend: () => Promise<MomentsBackend> = () => openDefaultBackend()) {}

  get = (): MomentsSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<MomentsSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Opens storage and reads every moment, once; later calls wait for the same load. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const backend = await this.openBackend().catch((): MomentsBackend => new MemoryBackend());
      this.backend = backend;
      const rows = await backend.all().catch(() => []);
      // Anything added while storage was opening is kept too.
      const byId = new Map<string, Moment>();
      for (const r of rows) {
        const m = asMoment(r);
        if (m) byId.set(m.id, m);
      }
      for (const m of this.snap.moments) {
        byId.set(m.id, m);
        if (!rows.some((r) => r.id === m.id)) void this.persist(() => backend.put(m));
      }
      this.set({ storage: backend.kind, moments: [...byId.values()].sort(newestFirst) });
      this.listenToOtherTabs();
    })();
    return this.loading;
  }

  get storage(): MomentsStorage {
    return this.snap.storage;
  }

  find(id: string): Moment | undefined {
    return this.snap.moments.find((m) => m.id === id);
  }

  async add(m: Moment): Promise<void> {
    this.set({ moments: [m, ...this.snap.moments.filter((x) => x.id !== m.id)].sort(newestFirst) });
    await this.persist((b) => b.put(m));
  }

  /** Applies a change to one moment; resolves with the result, or null when it is gone. */
  async update(id: string, change: (m: Moment) => Moment): Promise<Moment | null> {
    const current = this.find(id);
    if (!current) return null;
    const next = change(clone(current));
    this.set({ moments: this.snap.moments.map((x) => (x.id === id ? next : x)) });
    await this.persist((b) => b.put(next));
    return next;
  }

  /** Adds or replaces an action on its moment. */
  async putAction(momentId: string, action: AgentAction): Promise<void> {
    await this.update(momentId, (m) => ({
      ...m,
      actions: m.actions.some((a) => a.id === action.id) ? m.actions.map((a) => (a.id === action.id ? action : a)) : [...m.actions, action],
    }));
  }

  async remove(id: string): Promise<void> {
    this.set({ moments: this.snap.moments.filter((m) => m.id !== id) });
    await this.persist((b) => b.delete(id));
  }

  async clear(): Promise<void> {
    this.set({ moments: [] });
    await this.persist((b) => b.clear());
  }

  private async persist(write: (b: MomentsBackend) => Promise<void>) {
    const backend = this.backend;
    if (!backend) return; // load() writes what was added before storage opened
    try {
      await write(backend);
      if (this.snap.writeFailed) this.set({ writeFailed: false });
      this.channel?.postMessage("changed");
    } catch {
      this.set({ writeFailed: true });
    }
  }

  private listenToOtherTabs() {
    if (this.channel || this.backend?.kind !== "indexeddb" || typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = () => void this.reload();
  }

  private async reload() {
    const backend = this.backend;
    if (!backend) return;
    const rows = await backend.all().catch(() => null);
    if (!rows) return;
    this.set({ moments: rows.map(asMoment).filter((m): m is Moment => m !== null).sort(newestFirst) });
  }
}

export const momentsStore = new MomentsStore();

/** The moments, live. Starts loading on first use. */
export function useMoments(): MomentsSnapshot {
  useEffect(() => {
    void momentsStore.load();
  }, []);
  return useSyncExternalStore(momentsStore.subscribe, momentsStore.get, () => EMPTY);
}

/* ---- Exports ------------------------------------------------------------------- */

/** Every field of every moment, for people and programs. */
export function momentsToJson(moments: readonly Moment[], now: Date = new Date()): string {
  return JSON.stringify({ app: "signalive", kind: "moments", version: 1, exportedAt: now.toISOString(), moments }, null, 2);
}

/** For reading: oldest first, one section per moment, in the interface language. */
export function momentsToMarkdown(moments: readonly Moment[], opts: { messages: Messages; locale: Locale; now?: Date }): string {
  const { messages: m, locale } = opts;
  const d = m.moments.detail;
  const now = opts.now ?? new Date();
  const out = [
    `# ${m.moments.export.title}`,
    "",
    format(m.moments.export.exported, { when: formatDateTime(now.toISOString(), locale), n: moments.length }),
  ];
  for (const x of [...moments].sort((a, b) => -newestFirst(a, b))) {
    out.push("", `## ${x.title || formatDateTime(x.createdAt, locale)}`, "");
    out.push(`${formatDateTime(x.createdAt, locale)}${x.place?.name ? ` · ${x.place.name}` : ""}`);
    if (x.summary) out.push("", x.summary);
    if (x.keyPoints.length) out.push("", `### ${d.keyPoints}`, "", ...x.keyPoints.map((p) => `- ${p}`));
    if (x.actionItems.length) {
      out.push(
        "",
        `### ${d.actionItems}`,
        "",
        ...x.actionItems.map((a) => {
          const due = formatDue(a.due, locale, now);
          return `- [ ] ${a.text}${due ? ` (${format(d.dueAt, { when: due })})` : ""}`;
        }),
      );
    }
    if (x.people.length) out.push("", `${d.people}: ${x.people.join(", ")}`);
    if (x.topics.length) out.push("", `${d.topics}: ${x.topics.join(", ")}`);
    if (x.transcript) out.push("", `### ${d.transcript}`, "", ...x.transcript.split(/\n+/).map((l) => `> ${l}`));
  }
  return `${out.join("\n")}\n`;
}
