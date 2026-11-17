-- 227 — SecurityOps a diario para la pestaña Operación (Juan, 2026-11-17: «sí, vamos con eso»).
--
-- La extracción de AGT-004 se corría a mano con una sesión personal de Google que se revocó el 2026-10-24: la última
-- carga es del 14-oct. Desde ahora la corre el servidor de tareas con la cuenta de servicio de solo lectura de
-- SecurityOps y carga directo con la llave de servicio del CRM, así que service_role necesita insertar. Las cifras de
-- la semana (los últimos 7 días completos) responden «¿Qué falló?».

begin;

alter table public.siio_operations_metrics drop constraint if exists siio_operations_metrics_metric_check;
alter table public.siio_operations_metrics add constraint siio_operations_metrics_metric_check check (metric in (
  'puestos_activos',
  'visitas_supervisor',
  'puestos_visitados',
  'novedades',
  'tickets_creados',
  'tickets_abiertos',
  'tickets_vencidos_5d',
  'visitas_tecnico',
  'aprovisionamientos_programados',
  'aprovisionamientos_cumplidos',
  'rondas',
  'novedades_criticas_7d',
  'aprovisionamientos_7d',
  'aprovisionamientos_no_llego_7d',
  'revistas_7d',
  'revistas_canceladas_7d',
  'jornadas_noche_7d',
  'jornadas_tarde_7d'
));

grant insert on table public.siio_operations_runs to service_role;
grant insert on table public.siio_operations_metrics to service_role;

commit;
