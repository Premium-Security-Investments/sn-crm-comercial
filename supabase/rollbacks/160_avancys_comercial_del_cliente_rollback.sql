-- Revierte 160. La tabla sólo guarda la equivalencia de personas; borrarla no pierde ningún
-- cliente ni ningún reparto, porque eso vive en Avancys.
begin;
drop table if exists public.psi_avancys_salesperson_map;
commit;
