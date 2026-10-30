-- AGT-001 Vig-IA Gerencia: registrar SIIO Programación como fuente del SIIO.
-- La Torre muestra sus horas por cliente desde el 2026-10-21 (migración 143) y la fuente no
-- existía en el registro. Una cifra en pantalla cuya fuente no está registrada no se puede auditar.
-- Aditiva e idempotente. No cambia permisos ni toca el esquema `programacion`.

insert into public.siio_sources (
  id, name, source_type, related_fronts, owner, responsible_area, trust_level, status,
  permissions, allowed_agent_use, restrictions, update_frequency, last_reviewed_at
) values (
  'SRC-PROG-PROGRAMACION',
  'SIIO Programación (esquema programacion)',
  'Aplicación SIIO / base de datos',
  array['F2','F4'],
  'Programación / Operaciones',
  'Programación',
  'oficial_requiere_validacion',
  'activa',
  'Gerencia; Programación; agentes autorizados',
  'Leer agregados de horas, turnos y puestos por cliente. Nunca filas de personas.',
  'Piloto en Pereira. El cliente de cada puesto es un campo, no una deducción. Los parámetros de nómina están pendientes de validar con Nómina, así que no se publican pesos.',
  'mensual',
  current_date
)
on conflict (id) do nothing;
