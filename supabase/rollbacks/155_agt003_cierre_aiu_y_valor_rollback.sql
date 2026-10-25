-- Rollback de 155: devuelve el nombre viejo de la columna y la columna del AIU.
-- El AIU vuelve a quedar vacío en todos los formularios: su valor no se guardaba porque se calculaba, así que no hay
-- nada que restaurar. Si ya hay formularios guardados, quedarán sin AIU hasta que alguien lo escriba a mano.
begin;

alter table public.psi_sales_closure_form_posts rename column service_value to monthly_value;

alter table public.psi_sales_closure_forms
  add column if not exists aiu_value numeric(14, 2) check (aiu_value is null or aiu_value >= 0);

commit;
