-- Rollback de 181: quita el rastro de uso de la nota de campo. Pierde sólo el conteo de cupo; ningún dato del estudio.
begin;

drop function if exists public.psi_claim_security_study_agent_run(uuid, uuid, integer, timestamptz, integer, timestamptz);
drop table if exists public.psi_security_study_agent_runs;

commit;
