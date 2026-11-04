-- Rollback de 175: quita la regla y devuelve a nulo sólo las fechas que puso la 175 y nadie cambió después.
begin;

drop trigger if exists psi_sales_opportunity_approved_at_trg on public.psi_sales_opportunities;
drop function if exists public.psi_sales_opportunity_approved_at();

update public.psi_sales_opportunities o
   set approved_at = null
  from public.psi_sales_opportunity_audit_logs a
 where a.opportunity_id = o.id
   and a.field_name = 'approved_at'
   and a.notes like 'Migración 175:%'
   and o.approved_at::text = a.new_value;

commit;
