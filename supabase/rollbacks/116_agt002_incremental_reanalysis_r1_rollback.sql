-- Destructive only while R1 has never recorded evidence. Otherwise operational rollback is required.
begin;

do $$
declare
  v_signals bigint;
  v_sets bigint;
  v_transitions bigint;
begin
  select count(*) into v_signals from public.psi_agt002_incremental_signals;
  select count(*) into v_sets from public.psi_agt002_incremental_change_sets;
  select count(*) into v_transitions from public.psi_agt002_incremental_change_set_transitions;
  if v_signals > 0 or v_sets > 0 or v_transitions > 0 then
    raise exception 'Rollback 116 refused: incremental evidence exists (% signals, % sets, % transitions). Use operational rollback.',
      v_signals, v_sets, v_transitions using errcode = '55000';
  end if;
end $$;

drop function if exists public.psi_has_pending_agt002_incremental_change_sets();
drop function if exists public.psi_close_agt002_incremental_change_set(uuid, text, uuid, text, text);
drop function if exists public.psi_dispatch_agt002_incremental_change_set(uuid, uuid, text);
drop function if exists public.psi_seal_agt002_incremental_change_set(uuid, jsonb, text);
drop function if exists public.psi_record_agt002_incremental_signals(uuid, uuid, uuid, text, jsonb);
drop table public.psi_agt002_incremental_change_set_transitions;
drop table public.psi_agt002_incremental_signals;
drop table public.psi_agt002_incremental_change_sets;
drop function if exists public.psi_agt002_incremental_append_only_guard();

commit;
