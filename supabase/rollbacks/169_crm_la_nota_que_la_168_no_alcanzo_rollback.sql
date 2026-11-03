-- Rollback de 169: devuelve esa nota al año 2030.
begin;

update public.psi_sales_interactions set occurred_at = timestamptz '2030-05-22 18:24:00+00'
 where id = '6524632e-bcf2-4c6d-98d7-17a49d310859';

commit;
