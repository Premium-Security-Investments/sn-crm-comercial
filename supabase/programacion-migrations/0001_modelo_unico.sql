-- Programación de personal — modelo único (todas las ciudades; piloto Pereira).
-- Vive en el esquema `programacion` de la base del SIIO (Supabase tyfzjqzcpgwcjnxozaaf).
-- Turnos con fecha y hora reales, patrones definidos por su contenido,
-- novedades como rangos de fechas y parámetros de nómina con vigencia.
-- Datos personales: los mínimos. RLS activo en todas las tablas; sin acceso anónimo.

create schema if not exists programacion;

-- ---------- Catálogos ----------
create table programacion.ciudades (
  id            text primary key,                    -- 'pereira', 'medellin'
  nombre        text not null,
  dia_corte     smallint,                            -- 23 en Pereira; null = fin de mes
  metodo_extras text not null default 'legado_pereira'
                check (metodo_extras in ('legado_pereira', 'por_dia', 'por_periodo')),
  creado_en     timestamptz not null default now()
);

create table programacion.festivos (
  fecha       date primary key,
  nombre      text not null,
  creado_en   timestamptz not null default now()
);

-- Parámetros legales y de la empresa, con vigencia. Un cambio legal es una fila nueva.
create table programacion.parametros_nomina (
  id                    bigint generated always as identity primary key,
  ciudad_id             text references programacion.ciudades(id),   -- null = nacional
  vigente_desde         date not null,
  jornada_semanal       numeric(5,2) not null,     -- p. ej. 42, 43
  jornada_diaria_macro  numeric(6,4),              -- solo método legado (48/6 en Pereira)
  inicio_diurno         time not null default '06:00',
  fin_diurno            time not null default '19:00',
  divisor_valor_hora    numeric(6,2) not null,     -- 210, 220
  smlv                  numeric(12,2) not null,
  auxilio_transporte    numeric(12,2) not null,
  factores              jsonb not null,            -- {"hed":1.25,"hen":1.75,"rn":0.35,...}
  regla_domingos        jsonb,                     -- {"habitualidad_domingos":3,"primeras_horas_festivo":8}
  nota                  text,
  creado_en             timestamptz not null default now(),
  unique (ciudad_id, vigente_desde)
);

create table programacion.clientes (
  id            bigint generated always as identity primary key,
  nit           text not null unique,
  razon_social  text not null,
  sector        text,
  riesgo        text,
  ejecutivo     text,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

create table programacion.puestos (
  id              bigint generated always as identity primary key,
  ciudad_id       text not null references programacion.ciudades(id),
  cliente_id      bigint references programacion.clientes(id),
  nombre          text not null,
  direccion       text,
  municipio       text,
  cobertura       text,                              -- '24h', '12h', 'por_dias'
  guardas_requeridos smallint,
  requiere_arma   boolean not null default false,
  requiere_canino boolean not null default false,
  requiere_moto   boolean not null default false,
  centro_costo    text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

-- Empleado: solo lo necesario para programar y liquidar.
create table programacion.empleados (
  id              bigint generated always as identity primary key,
  ciudad_id       text not null references programacion.ciudades(id),
  tipo_documento  text not null default 'CC',
  documento       text not null,
  nombre          text not null,
  cargo           text not null default 'vigilante',
  fecha_ingreso   date,
  fecha_retiro    date,
  salario_base    numeric(12,2),
  habilitaciones  jsonb not null default '{}'::jsonb, -- {"arma":{"vence":"2027-01-01"},"moto":true}
  estado          text not null default 'activo' check (estado in ('activo', 'disponible', 'retirado')),
  creado_en       timestamptz not null default now(),
  unique (tipo_documento, documento)
);

-- ---------- Patrones y asignaciones ----------
-- Un patrón se define por su ciclo; el código es solo una etiqueta.
-- dias: [{ "tramos": [{"inicio":"18:00","fin":"06:00"}] }, { "tramos": [] }, ...]
--   (fin <= inicio significa que termina al día siguiente; [] = descanso)
-- Patrón semanal: ciclo 7 anclado al lunes, y horario_festivo opcional.
create table programacion.patrones_turno (
  id              bigint generated always as identity primary key,
  ciudad_id       text references programacion.ciudades(id),
  codigo          text not null,
  tipo            text not null check (tipo in ('rotativo', 'semanal', 'catalogo_cliente', 'manual')),
  ciclo_dias      smallint not null check (ciclo_dias between 1 and 62),
  dias            jsonb not null,
  horario_festivo jsonb,
  grupos          smallint not null default 1,
  desfase_grupos  smallint not null default 0,
  descripcion     text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  unique (ciudad_id, codigo)
);

create table programacion.asignaciones (
  id            bigint generated always as identity primary key,
  empleado_id   bigint not null references programacion.empleados(id),
  puesto_id     bigint not null references programacion.puestos(id),
  patron_id     bigint references programacion.patrones_turno(id),
  grupo         smallint not null default 1,
  ancla         date not null,                      -- fecha en la que el ciclo está en su día 1
  desde         date not null,
  hasta         date,
  creado_en     timestamptz not null default now(),
  check (hasta is null or hasta >= desde)
);

-- ---------- Periodos ----------
create table programacion.periodos (
  id            bigint generated always as identity primary key,
  ciudad_id     text not null references programacion.ciudades(id),
  inicio        date not null,
  fin           date not null,
  tipo          text not null default 'mensual' check (tipo in ('mensual', 'quincenal')),
  estado        text not null default 'abierto' check (estado in ('abierto', 'en_revision', 'cerrado')),
  parametros_id bigint references programacion.parametros_nomina(id),
  parametros_congelados jsonb,                      -- copia al cerrar
  cerrado_por   uuid,
  cerrado_en    timestamptz,
  creado_en     timestamptz not null default now(),
  unique (ciudad_id, inicio, fin),
  check (fin >= inicio)
);

-- ---------- Ejecución ----------
-- Un turno es UNO, aunque cruce la medianoche (18:00 a 06:00 = una fila).
create table programacion.turnos (
  id            bigint generated always as identity primary key,
  empleado_id   bigint not null references programacion.empleados(id),
  puesto_id     bigint references programacion.puestos(id),
  inicio        timestamp not null,                 -- hora local de Colombia
  fin           timestamp not null,
  origen        text not null default 'plantilla'
                check (origen in ('plantilla', 'cambio', 'apoyo', 'servicio_especial', 'evento', 'manual')),
  asignacion_id bigint references programacion.asignaciones(id),
  comentario    text,
  creado_por    uuid,
  creado_en     timestamptz not null default now(),
  check (fin > inicio and fin - inicio <= interval '24 hours')
);
create index turnos_empleado_inicio on programacion.turnos (empleado_id, inicio);
create index turnos_puesto_inicio on programacion.turnos (puesto_id, inicio);

create table programacion.novedades (
  id            bigint generated always as identity primary key,
  empleado_id   bigint not null references programacion.empleados(id),
  tipo          text not null check (tipo in (
                  'incapacidad', 'permiso_remunerado', 'permiso_no_remunerado', 'ausencia',
                  'sancion', 'vacaciones', 'retiro', 'no_vinculado', 'fuera_de_corte')),
  desde         date not null,
  hasta         date not null,
  soporte       text,
  comentario    text,
  estado        text not null default 'registrada' check (estado in ('registrada', 'aprobada', 'anulada')),
  creado_por    uuid,
  creado_en     timestamptz not null default now(),
  check (hasta >= desde)
);
create index novedades_empleado on programacion.novedades (empleado_id, desde);

-- ---------- Resultados ----------
create table programacion.resultados_nomina (
  id            bigint generated always as identity primary key,
  periodo_id    bigint not null references programacion.periodos(id),
  empleado_id   bigint not null references programacion.empleados(id),
  metodo        text not null,
  version_motor text not null,
  totales       jsonb not null,                     -- HED, HEN, RN, DoF, días, novedades...
  traza         jsonb,                              -- detalle por día
  calculado_en  timestamptz not null default now(),
  unique (periodo_id, empleado_id, metodo)
);

-- ---------- Historial de cambios ----------
create table programacion.historial (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro_id bigint,
  accion      text not null check (accion in ('insert', 'update', 'delete')),
  antes       jsonb,
  despues     jsonb,
  usuario     uuid,
  en          timestamptz not null default now()
);

create or replace function programacion.registrar_historial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into programacion.historial (tabla, registro_id, accion, antes, despues, usuario)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end $$;

create trigger historial_turnos after insert or update or delete on programacion.turnos
  for each row execute function programacion.registrar_historial();
create trigger historial_novedades after insert or update or delete on programacion.novedades
  for each row execute function programacion.registrar_historial();
create trigger historial_asignaciones after insert or update or delete on programacion.asignaciones
  for each row execute function programacion.registrar_historial();

-- ---------- Seguridad ----------
-- RLS en todo. Las políticas por rol y zona llegan con el login; hasta entonces
-- solo el backend (service role) lee y escribe.
alter table programacion.ciudades          enable row level security;
alter table programacion.festivos          enable row level security;
alter table programacion.parametros_nomina enable row level security;
alter table programacion.clientes          enable row level security;
alter table programacion.puestos           enable row level security;
alter table programacion.empleados         enable row level security;
alter table programacion.patrones_turno    enable row level security;
alter table programacion.asignaciones      enable row level security;
alter table programacion.periodos          enable row level security;
alter table programacion.turnos            enable row level security;
alter table programacion.novedades         enable row level security;
alter table programacion.resultados_nomina enable row level security;
alter table programacion.historial         enable row level security;

revoke all on schema programacion from anon;
revoke all on all tables in schema programacion from anon;
revoke execute on function programacion.registrar_historial() from public, anon, authenticated;
