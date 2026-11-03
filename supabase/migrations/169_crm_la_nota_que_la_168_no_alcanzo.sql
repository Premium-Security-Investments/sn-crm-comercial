-- AGT-003 — la nota que la 168 no alcanzó a corregir (2026-11-02).
--
-- La 168 devolvió a su fecha real tres seguimientos con fecha futura, cada uno con el valor viejo exigido en el
-- `where` para no tocar nada dos veces. Uno no se movió: su valor se había leído de una consulta que mostraba sólo el
-- día (`occurred_at::date`), así que el `where` pedía la medianoche y la fila tenía las 18:24. La guarda funcionó
-- exactamente como debía —no tocó lo que no coincidía— y la verificación posterior lo detectó.
--
-- Queda como migración aparte en vez de editar la 168, que ya está aplicada: la historia dice lo que pasó.
--
-- Es una oportunidad DESCARTADA, así que no afectaba a Mi día; lo que arregla es el historial, que mostraba una nota
-- del año 2030.
begin;

update public.psi_sales_interactions
   set occurred_at = created_at
 where id = '6524632e-bcf2-4c6d-98d7-17a49d310859'
   and occurred_at = timestamptz '2030-05-22 18:24:00+00';

commit;
