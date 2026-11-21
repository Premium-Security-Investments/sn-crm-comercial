-- Ajustes para cargar la programación existente sin perder información.
-- 1) Una novedad puede aplicar solo a una asignación (p. ej. "retirado" de un puesto
--    cuando el guarda pasó a otro en el mismo periodo). Null = aplica a todo el empleado.
alter table programacion.novedades
  add column asignacion_id bigint references programacion.asignaciones(id);
-- 2) Regla de dominicales anterior a 07-2018 (marca "24" del Excel de Pereira).
alter table programacion.asignaciones
  add column regla_dominical_antigua boolean not null default false;
-- 3) Empleados sin cargo clasificado todavía.
alter table programacion.empleados alter column cargo set default 'sin_clasificar';
