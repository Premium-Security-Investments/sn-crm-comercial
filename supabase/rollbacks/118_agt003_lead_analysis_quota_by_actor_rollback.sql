-- Reversa de 118: quita la reserva v2 del análisis profundo (el servidor vuelve a la reserva original de 114 con el
-- cupo del equipo de la configuración, con console.warn). No toca datos.
begin;
drop function if exists public.psi_claim_agt003_lead_analysis_v2(uuid, uuid, text, text, integer, timestamptz, integer, timestamptz);
commit;
