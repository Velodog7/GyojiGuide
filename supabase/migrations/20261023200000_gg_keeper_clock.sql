-- =====================================================================
--  SUMO SLAP DOWN: the keeper clock, every five minutes
-- ---------------------------------------------------------------------
--  A keeper window closes itself on draft day (its deadline) once the new
--  basho has been started. The hourly import checks for that too, but only
--  at minute 7, so a draft set for 7:30 would not open until 8:07. This asks
--  the Edge Function to run keeperClock() every five minutes; it does
--  nothing unless a window is due.
--
--  Written so it can never fail, like gg_cron: a migration error would also
--  stop the Edge Function from deploying. If pg_cron or pg_net is missing
--  this logs a notice, and the block can be re-run from the SQL editor.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'gg_keeper_clock: pg_cron/pg_net missing, job not scheduled';
    return;
  end if;
  -- every five minutes; scheduling under a name replaces any old job
  perform cron.schedule('gg-keeper-clock', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'action', '__cron',
        'job', 'keeperClock',
        'key', (select value from public.gg_props where key = '__CRON_KEY')),
      timeout_milliseconds := 60000)
  $job$);
exception when others then
  raise notice 'gg_keeper_clock: could not schedule (%)', sqlerrm;
end
$$;
