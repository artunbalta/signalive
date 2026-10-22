/**
 * Runs the real migration against a throwaway database on a local Postgres
 * (with pgvector) and checks row level security, cross user integrity,
 * search_notes, and delete_my_data.
 *
 *   npm run test:db
 *
 * Connection: PGHOST (default /tmp, the Homebrew socket), PGPORT (5432),
 * PGUSER (current user). The suite is skipped when no server answers.
 * Roles anon, authenticated and service_role are created only if missing and
 * dropped again afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = join(__dirname, "..", "..");
const shim = readFileSync(join(root, "supabase/tests/supabase-shim.sql"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20261021000000_init.sql"), "utf8");

const conn = {
  host: process.env.PGHOST ?? "/tmp",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
};
const dbName = `signalive_trial_test_${Date.now()}`;
const ROLES = ["anon", "authenticated", "service_role"];

const USER_TABLES = [
  "sessions", "device_profiles", "consents", "audio_objects", "utterances",
  "notes", "note_embeddings", "marks", "lab_runs", "lab_results", "latency_events",
];

let admin: pg.Client;
let db: pg.Client;
let createdRoles: string[] = [];
let available = true;

try {
  const probe = new pg.Client({ ...conn, database: "postgres", connectionTimeoutMillis: 1500 });
  await probe.connect();
  await probe.end();
} catch {
  available = false;
}

const vec = (seed: number) =>
  `[${Array.from({ length: 1024 }, (_, i) => (i === seed % 1024 ? 1 : 0.001 * ((i * seed) % 7))).join(",")}]`;

/** Runs fn as the given user inside a transaction, the way PostgREST does. */
async function asUser<T>(uid: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      uid ? JSON.stringify({ sub: uid, role: "authenticated", is_anonymous: true }) : "",
    ]);
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function errorCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

interface Seeded {
  session: string;
  deviceProfile: string;
  audioObject: string;
  note: string;
  labRun: string;
}

async function seed(uid: string): Promise<Seeded> {
  return asUser(uid, async (c) => {
    const one = async (sql: string, params: unknown[] = []) =>
      (await c.query(sql, params)).rows[0] as { id: string };
    const session = (await one("insert into public.sessions (ui_lang, speech_lang) values ('tr','auto') returning id")).id;
    const deviceProfile = (await one(
      "insert into public.device_profiles (session_id, input_label) values ($1, 'AirPods') returning id", [session])).id;
    await c.query("insert into public.consents (kind, version, granted) values ('terms', 'v1', true)");
    const audioObject = (await one(
      "insert into public.audio_objects (kind, path, bytes) values ('lab', $1, 10) returning id",
      [`${uid}/lab/take.wav`])).id;
    await c.query(
      `insert into public.utterances (session_id, source, text, language, started_at, ended_at, audio_object_id)
       values ($1, 'recorder', 'yarın toplantıda konuşuruz', 'tr', now(), now(), $2)`, [session, audioObject]);
    const note = (await one(
      `insert into public.notes (session_id, source, title, summary, language, search_text)
       values ($1, 'batch', 'Toplantı', 'Yarın toplantıda', 'tr', 'toplantı yarın toplantıda') returning id`, [session])).id;
    await c.query(
      "insert into public.note_embeddings (note_id, model, embedding) values ($1, 'mock-hash-1024', $2)",
      [note, vec(3)]);
    await c.query(
      "insert into public.marks (session_id, start_at, end_at, note_id) values ($1, now() - interval '60 seconds', now(), $2)",
      [session, note]);
    const labRun = (await one(
      `insert into public.lab_runs (session_id, device_profile_id, language, voice_style, environment, chains, providers, phrase_set_version)
       values ($1, $2, 'tr', 'whisper', 'wind_outdoors', '{raw}', '{mock}', 'v1') returning id`, [session, deviceProfile])).id;
    await c.query(
      `insert into public.lab_results (run_id, take_id, phrase_id, language, voice_style, environment, chain, provider, reference, audio_object_id)
       values ($1, gen_random_uuid(), 'tr-01', 'tr', 'whisper', 'wind_outdoors', 'raw', 'mock', 'merhaba', $2)`, [labRun, audioObject]);
    await c.query(
      "insert into public.latency_events (session_id, turn_id, input_mode) values ($1, gen_random_uuid(), 'ptt')", [session]);
    await c.query(
      "insert into storage.objects (bucket_id, name, owner) values ('audio', $1, $2)", [`${uid}/lab/take.wav`, uid]);
    return { session, deviceProfile, audioObject, note, labRun };
  });
}

async function countsFor(uid: string | null): Promise<Record<string, number>> {
  return asUser(uid, async (c) => {
    const out: Record<string, number> = {};
    for (const t of USER_TABLES) {
      out[t] = Number((await c.query(`select count(*)::int as n from public.${t}`)).rows[0].n);
    }
    return out;
  });
}

describe.skipIf(!available)("supabase schema (local Postgres)", () => {
  const A = randomUUID();
  const B = randomUUID();
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    admin = new pg.Client({ ...conn, database: "postgres" });
    await admin.connect();
    for (const role of ROLES) {
      const exists = (await admin.query("select 1 from pg_roles where rolname = $1", [role])).rowCount;
      if (!exists) {
        await admin.query(`create role ${role} nologin`);
        createdRoles.push(role);
      }
    }
    await admin.query(`create database ${dbName}`);
    db = new pg.Client({ ...conn, database: dbName });
    await db.connect();
    await db.query(shim);
    await db.query(migration);
    await db.query("insert into auth.users (id) values ($1), ($2)", [A, B]);
    a = await seed(A);
    b = await seed(B);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      for (const role of createdRoles) await admin.query(`drop role if exists ${role}`);
      createdRoles = [];
      await admin.end();
    }
  });

  it("enables RLS with own-row policies on every public table", async () => {
    const tables = (await db.query(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows as { relname: string; relrowsecurity: boolean }[];
    expect(tables.map((t) => t.relname).sort()).toEqual([...USER_TABLES].sort());
    for (const t of tables) expect(t.relrowsecurity, t.relname).toBe(true);

    const policies = (await db.query(
      "select tablename, cmd, roles::text from pg_policies where schemaname = 'public'")).rows as
      { tablename: string; cmd: string; roles: string }[];
    for (const t of USER_TABLES) {
      const cmds = policies.filter((p) => p.tablename === t).map((p) => p.cmd).sort();
      expect(cmds, t).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      for (const p of policies.filter((x) => x.tablename === t)) expect(p.roles).toBe("{authenticated}");
    }
  });

  it("gives every table a cascading user_id", async () => {
    for (const t of USER_TABLES) {
      const col = (await db.query(
        `select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = 'user_id'`, [t])).rows[0];
      expect(col?.is_nullable, t).toBe("NO");
      const fk = (await db.query(
        `select confdeltype from pg_constraint
          where conrelid = ('public.' || $1)::regclass and contype = 'f'
            and confrelid = 'auth.users'::regclass`, [t])).rows[0];
      expect(fk?.confdeltype, t).toBe("c");
    }
  });

  it("shows each user only their own rows", async () => {
    const ca = await countsFor(A);
    const cb = await countsFor(B);
    for (const t of USER_TABLES) {
      expect(ca[t], t).toBe(1);
      expect(cb[t], t).toBe(1);
    }
    const leaked = await asUser(A, async (c) =>
      (await c.query("select id from public.sessions where id = $1", [b.session])).rowCount);
    expect(leaked).toBe(0);
  });

  it("denies the anon role any access", async () => {
    for (const t of USER_TABLES) {
      expect(await errorCode(asUser(null, (c) => c.query(`select count(*) from public.${t}`))), t).toBe("42501");
    }
  });

  it("blocks writing rows owned by someone else", async () => {
    expect(await errorCode(asUser(A, (c) =>
      c.query("insert into public.sessions (user_id) values ($1)", [B])))).toBe("42501");

    const updated = await asUser(A, async (c) =>
      (await c.query("update public.notes set title = 'x' where id = $1", [b.note])).rowCount);
    expect(updated).toBe(0);

    const deleted = await asUser(A, async (c) =>
      (await c.query("delete from public.lab_runs where id = $1", [b.labRun])).rowCount);
    expect(deleted).toBe(0);

    expect(await errorCode(asUser(A, (c) =>
      c.query("update public.notes set user_id = $1 where id = $2", [B, a.note])))).toBe("42501");
  });

  it("blocks pointing a row at another user's row", async () => {
    // Foreign key checks bypass RLS, so this is what the composite keys are for.
    expect(await errorCode(asUser(A, (c) =>
      c.query(
        `insert into public.utterances (session_id, source, text, started_at, ended_at)
         values ($1, 'recorder', 'x', now(), now())`, [b.session])))).toBe("23503");
    expect(await errorCode(asUser(A, (c) =>
      c.query("insert into public.lab_results (run_id, take_id, phrase_id, language, voice_style, environment, chain, provider, reference) values ($1, gen_random_uuid(), 'x', 'en', 'normal', 'cafe', 'raw', 'mock', 'x')", [b.labRun])))).toBe("23503");
    expect(await errorCode(asUser(A, (c) =>
      c.query("insert into public.note_embeddings (note_id, model, embedding) values ($1, 'm', $2)", [b.note, vec(1)])))).toBe("23503");
  });

  it("keeps storage objects inside the owner's folder", async () => {
    expect(await errorCode(asUser(A, (c) =>
      c.query("insert into storage.objects (bucket_id, name) values ('audio', $1)", [`${B}/lab/evil.wav`])))).toBe("42501");
    const visible = await asUser(A, async (c) =>
      (await c.query("select name from storage.objects")).rows.map((r) => r.name as string));
    expect(visible).toEqual([`${A}/lab/take.wav`]);
    expect(await errorCode(asUser(A, (c) =>
      c.query("insert into public.audio_objects (kind, path) values ('lab', $1)", [`${B}/lab/x.wav`])))).toBe("23514");
  });

  it("searches only the caller's notes, by prefix and by meaning", async () => {
    const byText = await asUser(A, async (c) =>
      (await c.query("select * from public.search_notes('toplantı:*', null, null, 10)")).rows);
    expect(byText.map((r) => r.note_id)).toEqual([a.note]);
    expect(byText[0].text_rank).toBeGreaterThan(0);

    const byVector = await asUser(A, async (c) =>
      (await c.query("select * from public.search_notes(null, $1::extensions.vector, 'mock-hash-1024', 10)", [vec(3)])).rows);
    expect(byVector.map((r) => r.note_id)).toEqual([a.note]);
    expect(byVector[0].similarity).toBeCloseTo(1, 5);

    const otherModel = await asUser(A, async (c) =>
      (await c.query("select * from public.search_notes(null, $1::extensions.vector, 'other-model', 10)", [vec(3)])).rows);
    expect(otherModel).toEqual([]);

    const hybrid = await asUser(A, async (c) =>
      (await c.query("select * from public.search_notes('toplantı:*', $1::extensions.vector, 'mock-hash-1024', 10)", [vec(3)])).rows);
    expect(hybrid).toHaveLength(1);
    expect(hybrid[0].text_rank).not.toBeNull();
    expect(hybrid[0].similarity).not.toBeNull();
  });

  it("refuses search and delete for anon", async () => {
    expect(await errorCode(asUser(null, (c) => c.query("select public.delete_my_data()")))).toBe("42501");
    expect(await errorCode(asUser(null, (c) => c.query("select * from public.search_notes('x:*')")))).toBe("42501");
  });

  it("delete_my_data removes every row of the caller and nobody else's", async () => {
    const report = await asUser(A, async (c) =>
      (await c.query("select public.delete_my_data() as r")).rows[0].r as Record<string, number>);
    for (const t of USER_TABLES) expect(report[t], t).toBeGreaterThanOrEqual(1);

    // The app removes storage objects through the Storage API, which runs as
    // the user; the policy has to allow that.
    const removed = await asUser(A, async (c) =>
      (await c.query("delete from storage.objects where bucket_id = 'audio' and name like $1", [`${A}/%`])).rowCount);
    expect(removed).toBe(1);

    const ca = await countsFor(A);
    for (const t of USER_TABLES) expect(ca[t], t).toBe(0);
    const cb = await countsFor(B);
    for (const t of USER_TABLES) expect(cb[t], t).toBe(1);
    const bObjects = (await db.query("select count(*)::int as n from storage.objects where name like $1", [`${B}/%`])).rows[0].n;
    expect(bObjects).toBe(1);
  });

  it("removes all of a user's rows when the auth user is deleted", async () => {
    await db.query("delete from auth.users where id = $1", [B]);
    for (const t of USER_TABLES) {
      const n = (await db.query(`select count(*)::int as n from public.${t} where user_id = $1`, [B])).rows[0].n;
      expect(n, t).toBe(0);
    }
  });
});
