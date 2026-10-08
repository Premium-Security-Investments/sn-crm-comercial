-- Reversa de 114: elimina el registro de análisis profundos (se pierden los análisis guardados).
begin;
drop function if exists public.psi_finish_agt003_lead_analysis(uuid, text, text, text, text, jsonb, jsonb, text);
drop function if exists public.psi_claim_agt003_lead_analysis(uuid, uuid, text, text, integer, timestamptz);
drop trigger if exists psi_agt003_lead_analyses_guard on public.psi_agt003_lead_analyses;
drop table if exists public.psi_agt003_lead_analyses;
drop function if exists public.psi_agt003_lead_analyses_guard();
commit;
