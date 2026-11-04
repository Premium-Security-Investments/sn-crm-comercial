-- AGT-003 — la fecha de una venta deja de moverse sola (autorizado por Juan, 2026-11-04).
--
-- Medido el 2026-11-04: de 74 oportunidades ganadas, 73 no tenían `approved_at`. Partes del CRM (el correo semanal, la
-- tabla de ventas por trimestre del tablero) fechaban la venta por `updated_at`, que se mueve cada vez que alguien
-- toca la oportunidad: el 2026-10-22 la 146 las tocó todas y quedaron como vendidas en octubre; el 2026-11-03 la 174
-- tocó 38 y quedaron como vendidas en noviembre — 1.168 millones que no eran de noviembre, en la meta del mes.
--
-- Ninguna de las 73 tiene otro rastro de cuándo se ganó (ni cambio de etapa en la auditoría ni nota "Avanza a
-- Aprobado"): se registraron ya ganadas. La mejor fecha que existe es la de su registro, `created_at`; en las que
-- vinieron del Excel, esa fecha ya es el primer día de su mes de origen. Es una INFERENCIA y queda dicha en la
-- auditoría.
--
-- Además, desde aquí toda oportunidad que pase a `aprobado` guarda su `approved_at`, se gane por donde se gane: la
-- decisión ya lo hacía (`psi_record_opportunity_decision`), la edición de la ficha (`psi_persist_sales_opportunity`)
-- no.
begin;

with fechadas as (
  update public.psi_sales_opportunities
     set approved_at = created_at
   where stage_code = 'aprobado'
     and approved_at is null
     and deleted_at is null
  returning id, approved_at
)
insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
select id, null, 'approved_at', null, approved_at::text,
       'Migración 175: fecha de venta inferida de la fecha de registro (no había otro rastro de cuándo se ganó)'
  from fechadas;

create or replace function public.psi_sales_opportunity_approved_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.stage_code = 'aprobado' and new.approved_at is null
     and (tg_op = 'INSERT' or old.stage_code is distinct from 'aprobado') then
    new.approved_at := now();
  end if;
  return new;
end;
$function$;

revoke all on function public.psi_sales_opportunity_approved_at() from public, anon, authenticated;

drop trigger if exists psi_sales_opportunity_approved_at_trg on public.psi_sales_opportunities;
create trigger psi_sales_opportunity_approved_at_trg
  before insert or update of stage_code on public.psi_sales_opportunities
  for each row execute function public.psi_sales_opportunity_approved_at();

commit;
