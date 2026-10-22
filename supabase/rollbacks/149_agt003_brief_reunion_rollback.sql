-- Rollback de 149: quita el cupo y el rastro del bloque con IA del brief. El brief con datos del CRM sigue igual.
begin;

drop function if exists public.psi_claim_agt003_brief_run(uuid, uuid, integer, timestamptz, integer, timestamptz);
drop table if exists public.psi_agt003_brief_runs;

commit;
