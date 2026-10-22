-- Test only. The smallest slice of a Supabase database the migration depends
-- on, so the real migration can run against a plain local Postgres:
-- the auth schema with auth.users and auth.uid(), the API roles, an
-- extensions schema, and the storage schema with storage.foldername().
-- auth.uid() is defined the way Supabase defines it: from the JWT claims that
-- PostgREST puts in request.jwt.claims.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

create extension if not exists pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

-- Like a Supabase project created after mid 2026: schema usage is granted,
-- table privileges in public are not. The migration has to grant them.
grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
