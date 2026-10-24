-- Rollback de 151: quita el formulario de cierre del CRM.
--
-- PIERDE DATOS: se borran los formularios diligenciados, sus direcciones de prestación y sus puestos. Eso incluye
-- la única copia estructurada de los puestos vendidos, que en el mundo anterior sólo existía dibujada en un Word.
-- Antes de ejecutarlo, exportar lo que haya.
begin;

drop table if exists public.psi_sales_closure_form_posts;
drop table if exists public.psi_sales_closure_form_sites;
drop table if exists public.psi_sales_closure_forms;

commit;
