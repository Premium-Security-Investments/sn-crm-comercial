-- Reversa de 117: quita la reserva v2 del copiloto (el servidor vuelve solo a la reserva original con el tope del
-- equipo, con console.warn) y la columna actor_id de las reservas vivas (son temporales; no se pierde historial).
begin;
drop function if exists public.psi_claim_agt003_copilot_run_v2(text, uuid, integer, timestamptz, integer, timestamptz, integer, integer);
drop index if exists public.psi_agt003_copilot_claims_actor_idx;
drop index if exists public.psi_agt003_copilot_runs_actor_idx;
alter table public.psi_agt003_copilot_claims drop column if exists actor_id;
commit;
