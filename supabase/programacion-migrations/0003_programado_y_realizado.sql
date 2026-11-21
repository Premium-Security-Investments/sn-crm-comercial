-- Programado vs. realizado.
-- turnos_programados: el plan (generado desde los turnos tipo y ajustado por el coordinador).
-- turnos: lo que realmente se prestó. turno_programado_id enlaza cada turno realizado con
-- su turno planeado; null = no estaba programado (apoyo, cubrimiento, servicio especial).
-- Un turno programado sin turno realizado = no se prestó (debe explicarlo una novedad).

create table programacion.turnos_programados (
  id            bigint generated always as identity primary key,
  empleado_id   bigint not null references programacion.empleados(id),
  puesto_id     bigint references programacion.puestos(id),
  asignacion_id bigint references programacion.asignaciones(id),
  periodo_id    bigint references programacion.periodos(id),
  inicio        timestamp not null,
  fin           timestamp not null,
  origen        text not null default 'patron' check (origen in ('patron', 'excepcion', 'manual')),
  creado_por    uuid,
  creado_en     timestamptz not null default now(),
  check (fin > inicio and fin - inicio <= interval '24 hours')
);
create index turnos_programados_empleado_inicio on programacion.turnos_programados (empleado_id, inicio);
create index turnos_programados_puesto_inicio on programacion.turnos_programados (puesto_id, inicio);

alter table programacion.turnos
  add column turno_programado_id bigint references programacion.turnos_programados(id);
create index turnos_programado on programacion.turnos (turno_programado_id);

-- Turnos tipo: 'plan_mensual' = horario armado a mano para el mes, sin ciclo.
alter table programacion.patrones_turno drop constraint patrones_turno_tipo_check;
alter table programacion.patrones_turno add constraint patrones_turno_tipo_check
  check (tipo in ('rotativo', 'semanal', 'catalogo_cliente', 'plan_mensual', 'manual'));

create trigger historial_turnos_programados after insert or update or delete on programacion.turnos_programados
  for each row execute function programacion.registrar_historial();

alter table programacion.turnos_programados enable row level security;
revoke all on programacion.turnos_programados from anon;
