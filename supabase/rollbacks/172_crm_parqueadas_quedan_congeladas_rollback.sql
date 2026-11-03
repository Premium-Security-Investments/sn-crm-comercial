-- Rollback de 172: las ocho vuelven a no estar congeladas. La próxima gestión no se había tocado, así que no hay que
-- restaurarla. Sólo deshace las filas que siguen con el congelamiento que puso la 172 (mismo motivo).
begin;

update public.psi_sales_opportunities
   set frozen_until = null, frozen_reason = null, frozen_at = null, frozen_by = null
 where frozen_reason like '%queda congelada hasta ese día (AGT-003, 2026-11-03).'
   and frozen_by is null;

insert into public.psi_sales_opportunity_audit_logs (opportunity_id, changed_by, field_name, old_value, new_value, notes)
select opportunity_id, null, 'frozen_until', new_value, null, 'Rollback de la migración 172'
  from public.psi_sales_opportunity_audit_logs
 where notes = 'Migración 172: próxima gestión lejana convertida en congelamiento hasta esa misma fecha';

commit;
