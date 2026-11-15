-- 222 — Aliados: las uniones temporales y consorcios no van al CRM.
--
-- Juan Botero, 2026-11-15: «los UT sin duda no pasan al CRM, eso no nos sirve» y «los UT se pueden eliminar, pero sin
-- duda no se deben exponer en el CRM». Al 15-nov había 131 participaciones de uniones temporales o consorcios (130 sin
-- NIT, cargadas el 9 y el 14-nov desde la tabla de puntaje de Terminal, los datos abiertos de SECOP y las respuestas a
-- observaciones; y una, «Unión Temporal RedSeguridad», unida a un integrante). Las participaciones son de sólo agregar
-- (196): el borrado se hace aquí, con el disparador apagado sólo durante la operación y una copia íntegra en una tabla
-- aparte. Desde ahora la base no recibe participaciones a nombre de una unión temporal o un consorcio. Las de empresas
-- individuales, con o sin NIT, no se tocan.

begin;

create table if not exists public.psi_vigilance_participations_depuradas as
  select p.*, now() as depurada_en, ''::text as motivo from public.psi_vigilance_participations p where false;
alter table public.psi_vigilance_participations_depuradas enable row level security;
revoke all on table public.psi_vigilance_participations_depuradas from public, anon, authenticated, service_role;
grant select on table public.psi_vigilance_participations_depuradas to service_role;

insert into public.psi_vigilance_participations_depuradas
  select p.*, now(), 'Unión temporal o consorcio: no va al CRM (Juan, 2026-11-15; migración 222)'
  from public.psi_vigilance_participations p
  where p.company_label ~* '(uni[oó]n\s+temporal|\mu\.?\s?t\M|consorcio)'
    and not exists (select 1 from public.psi_vigilance_participations_depuradas d where d.id = p.id);

alter table public.psi_vigilance_participations disable trigger psi_vigilance_participations_append_only;
delete from public.psi_vigilance_participations p
  where p.company_label ~* '(uni[oó]n\s+temporal|\mu\.?\s?t\M|consorcio)'
    and exists (select 1 from public.psi_vigilance_participations_depuradas d where d.id = p.id);
alter table public.psi_vigilance_participations enable trigger psi_vigilance_participations_append_only;

alter table public.psi_vigilance_participations drop constraint if exists psi_vigilance_participations_sin_uniones_temporales;
alter table public.psi_vigilance_participations add constraint psi_vigilance_participations_sin_uniones_temporales
  check (company_label !~* '(uni[oó]n\s+temporal|\mu\.?\s?t\M|consorcio)');

do $$
declare v_ut integer;
begin
  select count(*) into v_ut from public.psi_vigilance_participations where company_label ~* '(uni[oó]n\s+temporal|\mu\.?\s?t\M|consorcio)';
  if v_ut <> 0 then raise exception 'Quedaron % participaciones de uniones temporales.', v_ut; end if;
end $$;

commit;
