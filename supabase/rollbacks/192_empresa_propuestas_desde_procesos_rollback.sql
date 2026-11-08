-- Reversa de la 192: quita las propuestas a la ficha y sus decisiones. Las versiones del registro de evidencia que se
-- crearon al confirmar se quedan (son la ficha verificada por una persona); respaldar las propuestas antes si se quiere.
begin;
drop function if exists public.psi_decide_company_fact(uuid, uuid, text);
drop function if exists public.psi_propose_company_fact(uuid, jsonb);
drop table if exists public.psi_company_fact_proposal_decisions;
drop table if exists public.psi_company_fact_proposals;
drop function if exists public.psi_company_fact_proposals_append_only();
commit;
