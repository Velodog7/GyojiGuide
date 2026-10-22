-- =====================================================================
--  SUMO SLAP DOWN: the hourly results import, as a pg_cron job
-- ---------------------------------------------------------------------
--  The old Apps Script project ran refreshResults() on an hourly trigger.
--  Here pg_cron asks the Edge Function to run it (POST action "__cron"),
--  presenting __CRON_KEY from gg_props. The function skips the job until
--  the cutover marks the data live (__LIVE), so the rehearsal copy is
--  never touched.
--
--  Written so it can never fail: a migration error would also stop the
--  Edge Function from deploying. If pg_cron or pg_net is unavailable this
--  logs a notice, and the job can be scheduled later from the SQL editor
--  by re-running the block at the bottom.
-- =====================================================================

do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'gg_cron: pg_net not enabled (%)', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'gg_cron: pg_cron not enabled (%)', sqlerrm;
  end;
end
$$;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'gg_cron: pg_cron/pg_net missing, job not scheduled';
    return;
  end if;
  -- minute 7 of every hour; scheduling under a name replaces any old job
  perform cron.schedule('gg-refresh-results', '7 * * * *', $job$
    select net.http_post(
      url := 'https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'action', '__cron',
        'job', 'refreshResults',
        'key', (select value from public.gg_props where key = '__CRON_KEY')),
      timeout_milliseconds := 120000)
  $job$);
exception when others then
  raise notice 'gg_cron: could not schedule (%)', sqlerrm;
end
$$;
