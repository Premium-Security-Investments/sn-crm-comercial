-- Fail-closed rollback: 109 only adds the request queue. Refused while a request is pending or running.
begin;
lock table public.psi_agt002_radar_import_requests in access exclusive mode;
do $$
begin
  if exists (select 1 from public.psi_agt002_radar_import_requests where status in ('pending', 'running')) then
    raise exception 'Rollback 109 refused: a Radar import request is pending or running.' using errcode = '55000';
  end if;
end;
$$;
drop table if exists public.psi_agt002_radar_import_requests;
commit;
