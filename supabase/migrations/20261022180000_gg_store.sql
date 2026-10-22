-- =====================================================================
--  SUMO SLAP DOWN: the sheet store
-- ---------------------------------------------------------------------
--  The backend (sumo-fantasy.gs) still thinks in spreadsheets: named
--  sheets of rows of cells. These tables hold exactly that, so the code
--  runs unchanged on Postgres (see supabase/functions/api/engine.js).
--
--    gg_sheets   one row per sheet, with a version bumped on every write
--    gg_rows     one row per spreadsheet row; cells is a JSON array and
--                dates are tagged {"$d": "<iso>"}; pos orders a sheet
--    gg_props    Script Properties (keys starting __ are the engine's)
--    gg_cache    CacheService (draft-room presence, admin lockout)
--
--  Nothing here is reachable with the publishable key: RLS is on with no
--  policies, and only service_role (the Edge Function) may run the
--  functions. Every function is one transaction.
-- =====================================================================

create sequence if not exists public.gg_pos_seq;

create table if not exists public.gg_sheets (
  name     text primary key,
  version  bigint not null default 1,
  created  timestamptz not null default now()
);

create table if not exists public.gg_rows (
  id     bigint generated always as identity primary key,
  sheet  text   not null references public.gg_sheets(name) on delete cascade,
  pos    bigint not null,
  cells  jsonb  not null default '[]'::jsonb
);
create index if not exists gg_rows_sheet_pos on public.gg_rows (sheet, pos);

create table if not exists public.gg_props (
  key    text primary key,
  value  text not null
);

create table if not exists public.gg_cache (
  key         text primary key,
  value       text not null,
  expires_at  timestamptz not null
);

-- staging for the Sheet -> Postgres copy; swapped in by gg_import_finish
create table if not exists public.gg_import_sheets (
  name  text primary key
);
create table if not exists public.gg_import_rows (
  sheet  text not null,
  idx    int  not null,
  cells  jsonb not null,
  primary key (sheet, idx)
);

-- the key pg_cron presents to the Edge Function; generated here, never in git
insert into public.gg_props (key, value)
values ('__CRON_KEY', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
--  gg_now: the store's clock. now(), unless a test session pinned it with
--  set_config('gg.now', ...), so cache expiry can follow a test's clock.
--  Requests through the API cannot set it.
-- ---------------------------------------------------------------------
create or replace function public.gg_now()
returns timestamptz
language sql stable
set search_path = public
as $$
  select coalesce(nullif(current_setting('gg.now', true), '')::timestamptz, now())
$$;


-- ---------------------------------------------------------------------
--  gg_patch: set individual cells of a row, padding with "" as needed
-- ---------------------------------------------------------------------
create or replace function public.gg_patch(p_cells jsonb, p_patch jsonb)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  v_arr jsonb := case when jsonb_typeof(p_cells) = 'array' then p_cells else '[]'::jsonb end;
  v_key text;
  v_val jsonb;
  v_i   int;
begin
  for v_key, v_val in select key, value from jsonb_each(coalesce(p_patch, '{}'::jsonb)) loop
    v_i := v_key::int;
    while jsonb_array_length(v_arr) < v_i loop
      v_arr := v_arr || '[""]'::jsonb;
    end loop;
    if jsonb_array_length(v_arr) = v_i then
      v_arr := v_arr || jsonb_build_array(v_val);
    else
      v_arr := jsonb_set(v_arr, array[v_key], v_val);
    end if;
  end loop;
  return v_arr;
end
$$;


-- ---------------------------------------------------------------------
--  gg_load: the named sheets (null for one that doesn't exist), plus,
--  when asked, the script properties and the live cache entries.
--  One statement, so every sheet comes from the same snapshot.
-- ---------------------------------------------------------------------
create or replace function public.gg_load(p_sheets text[], p_meta boolean default true)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'sheets', coalesce((
      select jsonb_object_agg(n.name,
        case when s.name is null then 'null'::jsonb
        else jsonb_build_object(
          'v', s.version,
          'rows', coalesce((
            select jsonb_agg(jsonb_build_array(r.id, r.cells) order by r.pos)
            from public.gg_rows r where r.sheet = s.name), '[]'::jsonb))
        end)
      from (select distinct unnest(coalesce(p_sheets, '{}'::text[])) as name) n
      left join public.gg_sheets s on s.name = n.name), '{}'::jsonb),
    'props', case when p_meta then coalesce((select jsonb_object_agg(key, value) from public.gg_props), '{}'::jsonb) end,
    'cache', case when p_meta then coalesce((
      select jsonb_object_agg(key, jsonb_build_array(value, floor(extract(epoch from expires_at) * 1000)::bigint))
      from public.gg_cache where expires_at > public.gg_now()), '{}'::jsonb) end,
    'now', floor(extract(epoch from public.gg_now()) * 1000)::bigint)
$$;


-- ---------------------------------------------------------------------
--  gg_commit: apply one request's writes atomically.
--
--  p = {
--    check: {sheet: version|null, ...} | null   versions the request read
--                                               under the script lock
--    ops:   [{op:'sheet'|'ins'|'put'|'set'|'del', sheet, id?, cells?}]
--    props: {set: {k: v}, del: [k]} | null
--    cache: {put: [[k, v, ttlSeconds]], del: [k]} | null
--  }
--
--  Writers to the same sheet take turns (advisory locks, taken in name
--  order so two commits can't deadlock). If any checked sheet has moved
--  on since it was read, nothing is written and the caller re-runs the
--  request on fresh data. Every written sheet's version goes up by one.
-- ---------------------------------------------------------------------
create or replace function public.gg_commit(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ops     jsonb := coalesce(p->'ops', '[]'::jsonb);
  v_check   jsonb := case when jsonb_typeof(p->'check') = 'object' then p->'check' end;
  v_names   text[];
  v_name    text;
  v_want    jsonb;
  v_have    bigint;
  v_op      jsonb;
  v_written text[] := '{}';
begin
  if jsonb_typeof(v_ops) <> 'array' then
    raise exception 'gg_commit: ops must be an array';
  end if;

  select coalesce(array_agg(x order by x), '{}') into v_names from (
    select jsonb_object_keys(coalesce(v_check, '{}'::jsonb)) as x
    union
    select o->>'sheet' from jsonb_array_elements(v_ops) o
  ) t where x is not null;

  foreach v_name in array v_names loop
    perform pg_advisory_xact_lock(hashtextextended('gg:sheet:' || v_name, 0));
  end loop;

  if v_check is not null then
    for v_name, v_want in select key, value from jsonb_each(v_check) loop
      select version into v_have from public.gg_sheets where name = v_name;
      if (jsonb_typeof(v_want) = 'null' and v_have is not null)
         or (jsonb_typeof(v_want) <> 'null' and (v_have is null or v_have <> (v_want #>> '{}')::bigint)) then
        return jsonb_build_object('ok', false, 'conflict', true, 'sheet', v_name);
      end if;
    end loop;
  end if;

  for v_op in select value from jsonb_array_elements(v_ops) loop
    v_name := v_op->>'sheet';
    case v_op->>'op'
      when 'sheet' then
        insert into public.gg_sheets (name) values (v_name) on conflict (name) do nothing;
      when 'ins' then
        insert into public.gg_rows (sheet, pos, cells)
        values (v_name, nextval('public.gg_pos_seq'), coalesce(v_op->'cells', '[]'::jsonb));
      when 'put' then
        update public.gg_rows set cells = coalesce(v_op->'cells', '[]'::jsonb)
        where id = (v_op->>'id')::bigint and sheet = v_name;
      when 'set' then
        update public.gg_rows set cells = public.gg_patch(cells, v_op->'cells')
        where id = (v_op->>'id')::bigint and sheet = v_name;
      when 'del' then
        delete from public.gg_rows where id = (v_op->>'id')::bigint and sheet = v_name;
      else
        raise exception 'gg_commit: unknown op %', v_op->>'op';
    end case;
    if v_name is not null and not (v_name = any(v_written)) then
      v_written := v_written || v_name;
    end if;
  end loop;

  if array_length(v_written, 1) is not null then
    update public.gg_sheets set version = version + 1 where name = any(v_written);
  end if;

  if jsonb_typeof(p->'props') = 'object' then
    insert into public.gg_props (key, value)
      select key, value from jsonb_each_text(coalesce(p->'props'->'set', '{}'::jsonb))
    on conflict (key) do update set value = excluded.value;
    delete from public.gg_props
      where key in (select jsonb_array_elements_text(coalesce(p->'props'->'del', '[]'::jsonb)));
  end if;

  if jsonb_typeof(p->'cache') = 'object' then
    insert into public.gg_cache (key, value, expires_at)
      select e->>0, e->>1, public.gg_now() + make_interval(secs => greatest(1, least(21600, coalesce((e->>2)::int, 600))))
      from jsonb_array_elements(coalesce(p->'cache'->'put', '[]'::jsonb)) e
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at;
    delete from public.gg_cache
      where key in (select jsonb_array_elements_text(coalesce(p->'cache'->'del', '[]'::jsonb)));
  end if;

  -- housekeeping, without ever waiting on another request
  delete from public.gg_cache where ctid in (
    select ctid from public.gg_cache where expires_at < public.gg_now() - interval '5 minutes'
    limit 50 for update skip locked);

  return jsonb_build_object('ok', true);
end
$$;


-- ---------------------------------------------------------------------
--  The import: begin (clear staging) -> rows (any order, resendable) ->
--  finish (check every count, then swap staging in, all at once).
-- ---------------------------------------------------------------------
create or replace function public.gg_import_begin()
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  delete from public.gg_import_rows;
  delete from public.gg_import_sheets;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.gg_import_rows(p_sheet text, p_start int, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  if p_sheet is null or p_sheet = '' then
    raise exception 'gg_import_rows: a sheet name is required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'gg_import_rows: rows must be an array';
  end if;
  insert into public.gg_import_sheets (name) values (p_sheet) on conflict (name) do nothing;
  insert into public.gg_import_rows (sheet, idx, cells)
    select p_sheet, p_start + (t.ord - 1)::int,
           case when jsonb_typeof(t.cells) = 'array' then t.cells else '[]'::jsonb end
    from jsonb_array_elements(p_rows) with ordinality as t(cells, ord)
  on conflict (sheet, idx) do update set cells = excluded.cells;
  return jsonb_build_object('ok', true, 'rows', jsonb_array_length(p_rows));
end
$$;

create or replace function public.gg_import_finish(p_expected jsonb, p_props jsonb, p_meta jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_name   text;
  v_want   int;
  v_have   int;
  v_names  text[];
  v_ver    bigint;
  v_maxpos bigint;
  v_rows   bigint;
  v_sheets bigint;
begin
  if jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'gg_import_finish: expected must be {sheet: rowCount}';
  end if;

  -- staging must hold exactly what the export says it sent
  for v_name, v_want in select key, (value #>> '{}')::int from jsonb_each(p_expected) loop
    if not exists (select 1 from public.gg_import_sheets where name = v_name) then
      raise exception 'import incomplete: sheet % never arrived', v_name;
    end if;
    select count(*) into v_have from public.gg_import_rows
      where sheet = v_name and idx between 1 and v_want;
    if v_have <> v_want then
      raise exception 'import incomplete: % has % of % rows', v_name, v_have, v_want;
    end if;
    if exists (select 1 from public.gg_import_rows where sheet = v_name and (idx < 1 or idx > v_want)) then
      raise exception 'import has stray rows in %', v_name;
    end if;
  end loop;
  if exists (select 1 from public.gg_import_sheets s where not (p_expected ? s.name)) then
    raise exception 'import has a sheet the export did not list';
  end if;

  -- hold off every writer: lock every sheet name, old and new, in order
  select coalesce(array_agg(n order by n), '{}') into v_names from (
    select name as n from public.gg_sheets
    union
    select name from public.gg_import_sheets) t;
  foreach v_name in array v_names loop
    perform pg_advisory_xact_lock(hashtextextended('gg:sheet:' || v_name, 0));
  end loop;

  -- move every version past anything an in-flight request holds, so its
  -- commit is refused and it re-runs on the imported data
  select coalesce(max(version), 0) + 1 into v_ver from public.gg_sheets;

  delete from public.gg_rows;
  delete from public.gg_sheets;
  insert into public.gg_sheets (name, version) select name, v_ver from public.gg_import_sheets;
  insert into public.gg_rows (sheet, pos, cells) select sheet, idx, cells from public.gg_import_rows;
  select coalesce(max(idx), 0) into v_maxpos from public.gg_import_rows;
  perform setval('public.gg_pos_seq', v_maxpos + 1, false);

  -- the Script Properties come across exactly; keys starting __ stay ours
  delete from public.gg_props where left(key, 2) <> '__';
  insert into public.gg_props (key, value)
    select key, value from jsonb_each_text(coalesce(p_props, '{}'::jsonb)) where left(key, 2) <> '__'
  on conflict (key) do update set value = excluded.value;
  insert into public.gg_props (key, value) values
    ('__GG_TZ', coalesce(nullif(p_meta->>'tz', ''), 'UTC')),
    ('__IMPORT_META', coalesce(p_meta, '{}'::jsonb)::text),
    ('__IMPORTED_AT', to_char(public.gg_now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  on conflict (key) do update set value = excluded.value;

  delete from public.gg_cache;

  select count(*) into v_rows from public.gg_rows;
  select count(*) into v_sheets from public.gg_sheets;
  delete from public.gg_import_rows;
  delete from public.gg_import_sheets;
  return jsonb_build_object('ok', true, 'sheets', v_sheets, 'rows', v_rows, 'version', v_ver);
end
$$;


-- ---------------------------------------------------------------------
--  gg_export_rows: one page of a sheet's rows, in order. The way back to
--  Apps Script (migrate.gs revertToAppsScript) reads the store with it.
-- ---------------------------------------------------------------------
create or replace function public.gg_export_rows(p_sheet text, p_offset int, p_limit int)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(t.cells order by t.pos), '[]'::jsonb)
  from (
    select cells, pos from public.gg_rows
    where sheet = p_sheet
    order by pos
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  ) t
$$;


-- ---------------------------------------------------------------------
--  gg_stats: per-sheet row counts and versions, for checking an import
-- ---------------------------------------------------------------------
create or replace function public.gg_stats()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'sheets', coalesce((
    select jsonb_object_agg(s.name, jsonb_build_object('rows', (select count(*) from public.gg_rows r where r.sheet = s.name), 'v', s.version))
    from public.gg_sheets s), '{}'::jsonb))
$$;


-- ---------------------------------------------------------------------
--  Lock it all down. Supabase grants new tables and functions in public
--  to anon and authenticated by default; take that back.
-- ---------------------------------------------------------------------
alter table public.gg_sheets        enable row level security;
alter table public.gg_rows          enable row level security;
alter table public.gg_props         enable row level security;
alter table public.gg_cache         enable row level security;
alter table public.gg_import_sheets enable row level security;
alter table public.gg_import_rows   enable row level security;

do $$
declare
  t text;
  f text;
begin
  foreach t in array array['gg_sheets', 'gg_rows', 'gg_props', 'gg_cache', 'gg_import_sheets', 'gg_import_rows'] loop
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table public.%I to service_role', t);
    end if;
  end loop;

  foreach f in array array[
    'public.gg_now()', 'public.gg_patch(jsonb, jsonb)', 'public.gg_load(text[], boolean)', 'public.gg_commit(jsonb)',
    'public.gg_import_begin()', 'public.gg_import_rows(text, int, jsonb)',
    'public.gg_import_finish(jsonb, jsonb, jsonb)', 'public.gg_export_rows(text, int, int)', 'public.gg_stats()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;

  revoke all on sequence public.gg_pos_seq from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on sequence public.gg_pos_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on sequence public.gg_pos_seq from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage, select, update on sequence public.gg_pos_seq to service_role;
  end if;
end
$$;


-- ---------------------------------------------------------------------
--  For browsing in the dashboard (Table Editor -> schema gg_admin).
--  Not exposed through the API.
-- ---------------------------------------------------------------------
create schema if not exists gg_admin;
revoke all on schema gg_admin from public;

create or replace view gg_admin.sheets as
  select s.name, s.version, count(r.id) as rows, s.created
  from public.gg_sheets s left join public.gg_rows r on r.sheet = s.name
  group by s.name, s.version, s.created
  order by s.name;

create or replace view gg_admin.sheet_rows as
  select r.sheet, row_number() over (partition by r.sheet order by r.pos) as row_number, r.cells, r.id
  from public.gg_rows r;
