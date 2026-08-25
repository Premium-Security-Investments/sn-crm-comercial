-- Roll back only the AGT-002 Radar deterministic-gate ledger introduced by 071.
begin;
drop function if exists public.psi_record_agt002_radar_gate_evaluation(uuid,text,text,text[],jsonb,jsonb,text,text,text,text,timestamptz);
drop trigger if exists psi_agt002_radar_gate_append_only on public.psi_agt002_radar_gate_evaluations;
drop function if exists public.psi_block_agt002_radar_gate_mutation();
drop table if exists public.psi_agt002_radar_gate_evaluations;
commit;
