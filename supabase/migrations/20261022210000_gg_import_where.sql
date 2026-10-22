-- =====================================================================
--  SUMO SLAP DOWN: the import, made acceptable to Supabase's safeupdate
-- ---------------------------------------------------------------------
--  Supabase loads pg-safeupdate for API requests, and it refuses any DELETE
--  or UPDATE without a WHERE clause, even inside a function ("DELETE
--  requires a WHERE clause", 21000). The import's clear-everything steps
--  had none, so the first rehearsal stopped at its first step, before
--  copying anything. Same functions, each bare DELETE now says WHERE true.
--
--  PGlite has no safeupdate, so tests/engine/sql.js now checks every gg_
--  function for a WHERE on each DELETE and UPDATE instead.
--  CREATE OR REPLACE keeps the grants made in 20261022180000_gg_store.sql.
-- =====================================================================

create or replace function public.gg_import_begin()
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  delete from public.gg_import_rows where true;
  delete from public.gg_import_sheets where true;
  return jsonb_build_object('ok', true);
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

  delete from public.gg_rows where true;
  delete from public.gg_sheets where true;
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

  delete from public.gg_cache where true;

  select count(*) into v_rows from public.gg_rows;
  select count(*) into v_sheets from public.gg_sheets;
  delete from public.gg_import_rows where true;
  delete from public.gg_import_sheets where true;
  return jsonb_build_object('ok', true, 'sheets', v_sheets, 'rows', v_rows, 'version', v_ver);
end
$$;
