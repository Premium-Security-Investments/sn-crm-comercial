-- Reversa de 115: elimina el registro de mensajes usados/descartados (los mensajes vuelven a mostrarse).
begin;
drop trigger if exists psi_agt003_lead_analysis_message_events_guard on public.psi_agt003_lead_analysis_message_events;
drop table if exists public.psi_agt003_lead_analysis_message_events;
drop function if exists public.psi_agt003_lead_analysis_message_events_guard();
commit;
