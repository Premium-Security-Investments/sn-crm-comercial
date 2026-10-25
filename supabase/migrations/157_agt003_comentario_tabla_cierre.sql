-- Completa la 155 (2026-10-25): el comentario de la tabla del formulario de cierre.
--
-- La 155 se aplicó a mano en el editor SQL de Supabase y le faltó su última sentencia: el
-- comentario de `psi_sales_closure_forms` quedó con el texto anterior, sin la regla del dinero.
-- Las otras tres sentencias de la 155 SÍ están aplicadas y verificadas contra producción
-- (`service_value` existe, `monthly_value` y `aiu_value` ya no, y el comentario de la columna trae
-- el texto nuevo), así que la 155 no se debe volver a correr: su `rename` fallaría contra una
-- columna que ya no existe.
--
-- Esta migración sólo repone lo que faltó. Es idempotente y transaccional.
begin;

comment on table public.psi_sales_closure_forms is
  'Formulario de cierre de un negocio nuevo (formato GGC-FO-001 v18), uno por oportunidad. Reemplaza el Word que el comercial mandaba por correo. Solo con el formulario completo se puede marcar la oportunidad como ganada. El dinero no se guarda: el AIU es el 10 % del valor del servicio y el IVA el 19 % del AIU, y los dos se calculan.';

commit;
