-- AGT-003 — la fecha de terminación del servicio es el último día, y cuenta (Juan, 2026-10-24).
--
-- La 151 exigía `service_end_date > service_start_date`. Con la definición nueva —la terminación es el último día de
-- servicio y se cuenta— un servicio de un solo día es legítimo (un evento, un refuerzo puntual) y hoy quedaba
-- prohibido por esa restricción. Se cambia a `>=`.
--
-- El cálculo de los días vive en `src/vigia/closure-form.js` y no en la base: aquí sólo se corrige lo que la base
-- impedía guardar.
begin;

alter table public.psi_sales_closure_forms drop constraint if exists psi_sales_closure_forms_dates;

alter table public.psi_sales_closure_forms
  add constraint psi_sales_closure_forms_dates
  check (service_end_date is null or service_start_date is null or service_end_date >= service_start_date);

comment on column public.psi_sales_closure_forms.service_end_date is
  'Último día de servicio, inclusive: un contrato del 1 de octubre al 31 de octubre son 31 días.';

commit;
