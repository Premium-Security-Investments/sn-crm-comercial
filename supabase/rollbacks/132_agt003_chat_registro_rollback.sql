-- Retroceso de la migración 132 (chat de registro AGT-003). Borra la conversación guardada.
begin;
drop function if exists public.psi_claim_agt003_chat_turn(uuid, text, integer, timestamptz, integer, timestamptz);
drop table if exists public.psi_agt003_chat_turns;
commit;
