-- Rollback de 154: vuelve a prohibir que la terminación sea el mismo día que el inicio.
-- Si existiera un formulario con servicio de un solo día, este rollback falla al validar la restricción. Eso es
-- correcto: no se debe borrar un dato guardado para poder volver atrás.
begin;

alter table public.psi_sales_closure_forms drop constraint if exists psi_sales_closure_forms_dates;

alter table public.psi_sales_closure_forms
  add constraint psi_sales_closure_forms_dates
  check (service_end_date is null or service_start_date is null or service_end_date > service_start_date);

commit;
