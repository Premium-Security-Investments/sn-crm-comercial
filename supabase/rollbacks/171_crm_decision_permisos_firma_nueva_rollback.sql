-- Rollback de 171: NO devuelve el permiso a anon/authenticated a propósito.
--
-- El estado anterior a la 171 era un error (la función de decisión, `security definer`, ejecutable con la llave
-- pública), no una configuración que alguien quisiera. Deshacer la 171 sería reabrir ese hueco. Si de verdad hiciera
-- falta, el comando sería:
--   grant execute on function public.psi_record_opportunity_decision(uuid, uuid, text, text, text, timestamptz, text, numeric, integer, text, date) to public;
select 1;
