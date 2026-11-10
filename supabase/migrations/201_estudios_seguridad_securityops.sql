-- Estudios de Seguridad Física: SecurityOps como fuente del estudio (Juan, 2026-11-10: "podemos construir ya").
--
-- SecurityOps es la aplicación de operación de campo. Juan: el formulario «Alerta de Riesgos» y la entrada «Estudio de
-- seguridad» del historial del puesto se están construyendo "precisamente para que sean unas de nuestras fuentes de
-- información". Aquí el estudio se vincula a un puesto de SecurityOps y recibe sus antecedentes.
--
-- Lo trae un trabajo del servidor de tareas (ops/estudios-seguridad/), que es donde vive la cuenta de servicio de SOLO
-- LECTURA de SecurityOps; la llave no viaja a Vercel. El SIIO sólo lee estas tablas. Nada de datos de personas: ni
-- nombres de guardas o supervisores, ni cédulas, ni selfies, ni biometría; de las novedades sólo conteos.
--
--   psi_securityops_puestos             directorio de puestos para buscar y vincular (se refresca a diario).
--   psi_security_studies.securityops_*  el puesto vinculado y cuándo se pidió traer sus datos.
--   psi_security_study_securityops      lo que se trajo para cada estudio: resumen de 12 meses, alertas de riesgo,
--                                       notas de coordinación («Estudio de seguridad» del historial) y fallas.
--   psi_security_study_risks.origin     admite 'securityops', con source_ref = la alerta o nota de donde salió.
begin;

create table if not exists public.psi_securityops_puestos (
  id text primary key check (length(id) between 1 and 128),
  name text not null,
  address text,
  municipio text,
  departamento text,
  regional text,
  zone integer,
  sap text,
  kind text,
  monitoring boolean not null default false,
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  geo_pending boolean not null default false,
  active boolean not null default true,
  -- Nombre, dirección y municipio sin tildes y en minúsculas, para buscar con ilike.
  search_text text not null default '',
  synced_at timestamptz not null default now()
);
create index if not exists psi_securityops_puestos_active_idx on public.psi_securityops_puestos (active, monitoring);

alter table public.psi_security_studies
  add column if not exists securityops_puesto_id text check (securityops_puesto_id is null or length(securityops_puesto_id) between 1 and 128),
  add column if not exists securityops_requested_at timestamptz;

create table if not exists public.psi_security_study_securityops (
  study_id uuid primary key references public.psi_security_studies(id) on delete cascade,
  puesto_id text not null,
  status text not null check (status in ('ok', 'error')),
  synced_at timestamptz not null default now(),
  window_from date,
  window_to date,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array'),
  failures jsonb not null default '[]'::jsonb check (jsonb_typeof(failures) = 'array'),
  error text check (error is null or length(error) <= 300)
);

alter table public.psi_security_study_risks drop constraint if exists psi_security_study_risks_origin_check;
alter table public.psi_security_study_risks add constraint psi_security_study_risks_origin_check
  check (origin in ('manual', 'agente', 'securityops'));
alter table public.psi_security_study_risks
  add column if not exists source_ref text check (source_ref is null or source_ref ~ '^securityops:(alerta|nota):[A-Za-z0-9_-]{1,128}$');
alter table public.psi_security_study_risks drop constraint if exists psi_security_study_risks_source_consistency;
alter table public.psi_security_study_risks add constraint psi_security_study_risks_source_consistency
  check ((origin = 'securityops') = (source_ref is not null));

alter table public.psi_securityops_puestos enable row level security;
alter table public.psi_security_study_securityops enable row level security;
revoke all on table public.psi_securityops_puestos from public, anon, authenticated;
revoke all on table public.psi_security_study_securityops from public, anon, authenticated;
grant select, insert, update, delete on table public.psi_securityops_puestos to service_role;
grant select, insert, update, delete on table public.psi_security_study_securityops to service_role;

commit;
