-- Signalive web trial: initial schema.
--
-- Every table carries user_id and has row level security, with policies that
-- let a signed in user (anonymous or permanent, both use the authenticated
-- role) touch only their own rows. Foreign keys between user tables include
-- user_id, so a row can never point at another user's row: foreign key checks
-- bypass RLS, and without this a user could attach rows to someone else's
-- session and have them removed by that user's cascade.
--
-- Nothing here stores raw audio. Audio only exists as objects in the private
-- "audio" bucket when the user opted in, tracked by audio_objects so they can
-- expire and be deleted.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- sessions: one per app visit
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ui_lang text not null default 'en' check (ui_lang in ('en', 'tr')),
  speech_lang text not null default 'auto' check (speech_lang in ('en', 'tr', 'auto')),
  browser text not null default '',
  os text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (id, user_id)
);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- device_profiles: what the browser reported and what the setup wizard measured
-- ---------------------------------------------------------------------------
create table public.device_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid,
  input_label text not null default '',
  output_label text,
  track_sample_rate integer,
  context_sample_rate integer,
  channel_count smallint,
  browser text not null default '',
  os text not null default '',
  is_mobile boolean not null default false,
  bluetooth_suspected boolean not null default false,
  hands_free_suspected boolean not null default false,
  effective_bandwidth_hz integer,
  rms_dbfs real,
  peak_dbfs real,
  noise_floor_dbfs real,
  wind_low_freq_ratio real,
  output_selectable boolean not null default false,
  media_keys jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.sessions (id, user_id) on delete cascade
);
create index device_profiles_user_idx on public.device_profiles (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- consents: append only log; withdrawing adds a row with granted = false
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('terms', 'raw_audio_retention', 'lab_audio')),
  version text not null,
  granted boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index consents_user_kind_idx on public.consents (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- audio_objects: index of opted in recordings in the private "audio" bucket
-- ---------------------------------------------------------------------------
create table public.audio_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('recorder', 'lab')),
  bucket text not null default 'audio',
  path text not null unique,
  bytes integer not null default 0,
  duration_ms integer not null default 0,
  sample_rate integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  -- Paths always start with the owner's id, which is also what the storage
  -- policies check.
  check (split_part(path, '/', 1) = user_id::text)
);
create index audio_objects_expiry_idx on public.audio_objects (expires_at) where expires_at is not null;
create index audio_objects_user_idx on public.audio_objects (user_id);

-- ---------------------------------------------------------------------------
-- utterances: transcripts from the recorder and the assistant
-- ---------------------------------------------------------------------------
create table public.utterances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid,
  source text not null check (source in ('recorder', 'assistant')),
  role text not null default 'user' check (role in ('user', 'assistant')),
  text text not null,
  language text check (language in ('en', 'tr')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms integer not null default 0,
  stt_provider text,
  stt_model text,
  confidence real,
  audio_object_id uuid,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.sessions (id, user_id) on delete cascade,
  foreign key (audio_object_id, user_id) references public.audio_objects (id, user_id)
    on delete set null (audio_object_id)
);
create index utterances_user_started_idx on public.utterances (user_id, started_at);

-- ---------------------------------------------------------------------------
-- notes: structured notes extracted by the LLM
-- search_text is normalized by the app (Turkish aware lowercasing), so the
-- database only has to tokenize on whitespace.
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid,
  source text not null check (source in ('batch', 'on_demand', 'mark')),
  title text not null,
  summary text not null,
  action_items jsonb not null default '[]'::jsonb,
  topics text[] not null default '{}',
  people_mentioned text[] not null default '{}',
  language text not null check (language in ('en', 'tr')),
  period_start timestamptz,
  period_end timestamptz,
  utterance_ids uuid[] not null default '{}',
  model text not null default '',
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('simple'::regconfig, search_text)) stored,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.sessions (id, user_id)
    on delete set null (session_id)
);
create index notes_user_created_idx on public.notes (user_id, created_at desc);
create index notes_search_tsv_idx on public.notes using gin (search_tsv);

-- Exact per user nearest neighbour search: a user has at most a few thousand
-- notes, and an approximate index shared by all users would filter by owner
-- after picking candidates, which can silently return nothing.
create table public.note_embeddings (
  note_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model text not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  primary key (note_id, model),
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete cascade
);
create index note_embeddings_user_model_idx on public.note_embeddings (user_id, model);

-- ---------------------------------------------------------------------------
-- marks: "mark this moment" tags the preceding 60 seconds
-- ---------------------------------------------------------------------------
create table public.marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  label text,
  note_id uuid,
  created_at timestamptz not null default now(),
  check (end_at >= start_at),
  foreign key (session_id, user_id) references public.sessions (id, user_id) on delete cascade,
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete set null (note_id)
);
create index marks_user_idx on public.marks (user_id, start_at);

-- ---------------------------------------------------------------------------
-- lab_runs and lab_results: the whisper and noise lab
-- ---------------------------------------------------------------------------
create table public.lab_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid,
  device_profile_id uuid,
  device_label text not null default '',
  language text not null check (language in ('en', 'tr')),
  voice_style text not null check (voice_style in ('normal', 'whisper')),
  environment text not null
    check (environment in ('quiet_room', 'street', 'cafe', 'wind_outdoors', 'vehicle')),
  chains text[] not null,
  providers text[] not null,
  phrase_set_version text not null,
  store_audio boolean not null default false,
  dual_capture boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.sessions (id, user_id)
    on delete set null (session_id),
  foreign key (device_profile_id, user_id) references public.device_profiles (id, user_id)
    on delete set null (device_profile_id)
);
create index lab_runs_user_idx on public.lab_runs (user_id, started_at desc);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null,
  take_id uuid not null,
  phrase_id text not null,
  language text not null check (language in ('en', 'tr')),
  voice_style text not null check (voice_style in ('normal', 'whisper')),
  environment text not null
    check (environment in ('quiet_room', 'street', 'cafe', 'wind_outdoors', 'vehicle')),
  device_label text not null default '',
  chain text not null check (chain in ('browser_default', 'raw', 'raw_rnnoise', 'raw_hpf_gate')),
  provider text not null,
  model text not null default '',
  reference text not null,
  hypothesis text not null default '',
  ref_words integer not null default 0,
  ref_chars integer not null default 0,
  substitutions integer not null default 0,
  deletions integer not null default 0,
  insertions integer not null default 0,
  char_errors integer not null default 0,
  wer real,
  cer real,
  stt_latency_ms integer,
  audio_ms integer not null default 0,
  rms_dbfs real,
  snr_db_estimate real,
  low_freq_ratio real,
  audio_object_id uuid,
  error text,
  created_at timestamptz not null default now(),
  foreign key (run_id, user_id) references public.lab_runs (id, user_id) on delete cascade,
  foreign key (audio_object_id, user_id) references public.audio_objects (id, user_id)
    on delete set null (audio_object_id)
);
create index lab_results_user_idx on public.lab_results (user_id, created_at);
create index lab_results_run_idx on public.lab_results (run_id);

-- ---------------------------------------------------------------------------
-- latency_events: per exchange stage timings, metrics only
-- ---------------------------------------------------------------------------
create table public.latency_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid,
  turn_id uuid not null,
  kind text not null default 'turn' check (kind in ('turn', 'onboarding')),
  input_mode text not null check (input_mode in ('ptt', 'vad')),
  whisper boolean not null default false,
  language text check (language in ('en', 'tr')),
  stt_provider text,
  stt_mode text check (stt_mode in ('stream', 'batch')),
  llm_model text,
  tts_provider text,
  endpointing_ms integer,
  stt_final_ms integer,
  llm_first_token_ms integer,
  first_sentence_ms integer,
  tts_first_audio_ms integer,
  playback_start_ms integer,
  since_landing_ms integer,
  barge_in boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.sessions (id, user_id)
    on delete set null (session_id)
);
create index latency_events_user_idx on public.latency_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Grants and row level security: every table, own rows only.
-- New Supabase projects no longer grant table privileges in public
-- automatically, so they are granted here, table by table (never "all tables
-- in schema public", which would also open unrelated tables in the project).
-- anon gets nothing. service_role is used only by the expiry cron and the
-- admin export, and bypasses RLS.
-- (select auth.uid()) is evaluated once per statement instead of per row.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'device_profiles', 'consents', 'audio_objects', 'utterances',
    'notes', 'note_embeddings', 'marks', 'lab_runs', 'lab_results', 'latency_events'
  ] loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated, service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- search_notes: full text (prefix match) and semantic search fused by
-- reciprocal rank. Security invoker, so the caller's RLS applies; the explicit
-- user filter lets the planner use the per user indexes.
--
-- query_tsquery is built by the app from normalized words, each one
-- sanitized to letters and digits and suffixed with :* for prefix matching,
-- which matters for Turkish suffixes ("toplantı" finds "toplantıda").
-- ---------------------------------------------------------------------------
create or replace function public.search_notes(
  query_tsquery text default null,
  query_embedding extensions.vector(1024) default null,
  embedding_model text default null,
  match_count integer default 10
)
returns table (note_id uuid, text_rank real, similarity double precision, score double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      (select auth.uid()) as uid,
      case when coalesce(query_tsquery, '') = '' then null
           else to_tsquery('simple'::regconfig, query_tsquery) end as q,
      greatest(1, least(coalesce(match_count, 10), 50)) as k
  ),
  fts as (
    select n.id,
           ts_rank_cd(n.search_tsv, p.q) as rank,
           row_number() over (order by ts_rank_cd(n.search_tsv, p.q) desc, n.created_at desc) as rn
    from public.notes n, params p
    where p.q is not null and n.user_id = p.uid and n.search_tsv @@ p.q
    order by rank desc
    limit (select k * 4 from params)
  ),
  sem as (
    select e.note_id as id,
           1 - (e.embedding operator(extensions.<=>) query_embedding) as sim,
           row_number() over (order by e.embedding operator(extensions.<=>) query_embedding) as rn
    from public.note_embeddings e, params p
    where query_embedding is not null and e.user_id = p.uid and e.model = embedding_model
    order by e.embedding operator(extensions.<=>) query_embedding
    limit (select k * 4 from params)
  )
  select coalesce(fts.id, sem.id) as note_id,
         fts.rank as text_rank,
         sem.sim as similarity,
         coalesce(1.0 / (60 + fts.rn), 0) + coalesce(1.0 / (60 + sem.rn), 0) as score
  from fts
  full outer join sem on fts.id = sem.id
  order by score desc
  limit (select k from params);
$$;

-- ---------------------------------------------------------------------------
-- delete_my_data: removes every row the caller owns and reports counts.
-- Storage objects are removed by the app through the Storage API first; this
-- only removes their index rows.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result jsonb := '{}'::jsonb;
  n integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from public.marks where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('marks', n);
  delete from public.note_embeddings where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('note_embeddings', n);
  delete from public.notes where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('notes', n);
  delete from public.utterances where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('utterances', n);
  delete from public.lab_results where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('lab_results', n);
  delete from public.lab_runs where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('lab_runs', n);
  delete from public.latency_events where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('latency_events', n);
  delete from public.audio_objects where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('audio_objects', n);
  delete from public.device_profiles where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('device_profiles', n);
  delete from public.consents where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('consents', n);
  delete from public.sessions where user_id = uid;
  get diagnostics n = row_count; result := result || jsonb_build_object('sessions', n);

  return result;
end;
$$;

revoke execute on function public.search_notes(text, extensions.vector, text, integer) from public, anon;
revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.search_notes(text, extensions.vector, text, integer) to authenticated;
grant execute on function public.delete_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects live under "<user id>/..."
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 10485760, array['audio/wav'])
on conflict (id) do nothing;

create policy "audio: read own" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "audio: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "audio: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid()::text));
