-- Rollback de 174: deja sin clasificar sólo lo que clasificó la 174 y nadie cambió después.
begin;

update public.psi_sales_opportunities o
   set client_deal_type = null
  from public.psi_sales_opportunity_audit_logs a
 where a.opportunity_id = o.id
   and a.notes = 'Migración 174: clasificación inferida de la observación y el servicio de la oportunidad'
   and o.client_deal_type = a.new_value;

commit;
