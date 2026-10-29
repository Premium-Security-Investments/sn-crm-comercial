-- Revierte 161. Sólo se pierden los enlaces confirmados; ningún cliente ni oportunidad se toca.
begin;
drop table if exists public.psi_cliente_avancys;
commit;
