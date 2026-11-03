-- AGT-003 — la decisión de oportunidades vuelve a ser sólo del servidor (2026-11-03).
--
-- La 110 dejó `psi_record_opportunity_decision` con `revoke all ... from public, anon, authenticated` y
-- `grant execute ... to service_role`. Esos permisos son de la FIRMA, no del nombre: cuando la 170 agregó
-- `p_frozen_until` y la firma de 10 parámetros se borró, la de 11 nació con los permisos por omisión de PostgreSQL,
-- que dan EXECUTE a PUBLIC. Medido el 2026-11-03 sobre producción: `anon` y `authenticated` podían ejecutarla.
--
-- Es `security definer` y recibe el `p_actor_profile_id` como parámetro, así que cualquiera con la llave pública
-- podía registrar decisiones a nombre de otro saltándose la autorización del servidor. El servidor la llama con
-- `service_role` (server/index.js), así que quitarles el permiso a los demás no le cambia nada a la aplicación.
begin;

revoke all on function public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text, date) from public, anon, authenticated;
grant execute on function public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text, date) to service_role;

commit;
