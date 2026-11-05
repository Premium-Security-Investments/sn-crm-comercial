-- Estudios de Seguridad Física, tramo 5: lo que falta capturar (Juan, 2026-11-05: "vamos con tramo 5").
--
-- El informe real de HADA International (PDF de 39 páginas, octubre de 2026) es lo que el cliente recibe, y trae
-- datos que el SIIO no capturaba (docs/plans/2026-11-04-estudios-seguridad-fisica-mvp.md §2):
--   · en cada riesgo, el PROCESO DEL CLIENTE (Gestión Humana, Comercio Exterior, Producción…) y el FACTOR DE RIESGO
--     ("Humano – Procedimental – Estratégico"). El proceso del catálogo P01–P22 queda como clasificación técnica;
--   · la caracterización de la sede: descripción del cliente, ubicación y vía de aproximación, coordenadas, contexto
--     externo (situación delincuencial con sus fuentes), grupos delincuenciales y contexto interno;
--   · tres tablas: estadística de delitos (con fuente y fecha de corte), contactos (entidades de apoyo, Seguridad
--     Nacional, interventor) y el dispositivo de seguridad (sembrable desde los puestos del contrato en Avancys);
--   · para qué sirve cada archivo adjunto: evidencia de un riesgo, mapa de la sede o logo del cliente.
--
-- Todo es aditivo y opcional: los estudios existentes siguen valiendo. Como el resto del módulo, sólo el servidor
-- (`service_role`) lee y escribe.
begin;

alter table public.psi_security_study_risks
  add column if not exists client_process text check (client_process is null or length(btrim(client_process)) between 2 and 120),
  add column if not exists risk_factor text check (risk_factor is null or length(btrim(risk_factor)) between 2 and 200);

alter table public.psi_security_studies
  add column if not exists client_description text check (client_description is null or length(client_description) <= 4000),
  add column if not exists location_description text check (location_description is null or length(location_description) <= 4000),
  add column if not exists latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  add column if not exists longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  add column if not exists external_context text check (external_context is null or length(external_context) <= 8000),
  add column if not exists criminal_groups text check (criminal_groups is null or length(criminal_groups) <= 4000),
  add column if not exists internal_context text check (internal_context is null or length(internal_context) <= 8000),
  -- Fuentes citadas en el contexto (INDEPAZ, alertas tempranas de la Defensoría…): [{nombre, url, fecha}].
  add column if not exists context_sources jsonb not null default '[]'::jsonb check (jsonb_typeof(context_sources) = 'array');

-- Para qué sirve cada archivo: 'evidencia' (de un riesgo o general), 'mapa' (de la sede) o 'logo' (del cliente).
alter table public.psi_security_study_evidence
  add column if not exists purpose text not null default 'evidencia' check (purpose in ('evidencia', 'mapa', 'logo'));

create table if not exists public.psi_security_study_crime_stats (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  crime text not null check (length(btrim(crime)) between 2 and 160),
  count integer not null check (count >= 0),
  source text not null check (length(btrim(source)) between 2 and 300),
  cutoff_date date,
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.psi_security_study_contacts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  -- apoyo: Policía, Bomberos, Cruz Roja…; empresa: Seguridad Nacional; interventor: del contrato, por el cliente.
  kind text not null check (kind in ('apoyo', 'empresa', 'interventor')),
  entity text not null check (length(btrim(entity)) between 2 and 160),
  detail text check (detail is null or length(btrim(detail)) <= 200),
  phone text check (phone is null or length(btrim(phone)) <= 120),
  email text check (email is null or length(btrim(email)) <= 160),
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.psi_security_study_posts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  -- De dónde salió: un puesto del contrato en Avancys (con su código) o escrito en el estudio.
  source text not null default 'manual' check (source in ('avancys', 'manual')),
  source_ref text,
  constraint psi_security_study_posts_ref_required check (source = 'manual' or source_ref is not null),
  name text not null check (length(btrim(name)) between 2 and 200),
  modality text not null default 'vigilancia' check (modality in ('vigilancia', 'guia_canino', 'supervision', 'monitoreo', 'otro')),
  schedule text check (schedule is null or length(btrim(schedule)) <= 120),
  armed boolean,
  quantity integer not null default 1 check (quantity between 1 and 999),
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now()
);

create index if not exists psi_security_study_crime_stats_study_idx on public.psi_security_study_crime_stats(study_id);
create index if not exists psi_security_study_contacts_study_idx on public.psi_security_study_contacts(study_id);
create index if not exists psi_security_study_posts_study_idx on public.psi_security_study_posts(study_id);

alter table public.psi_security_study_crime_stats enable row level security;
alter table public.psi_security_study_contacts enable row level security;
alter table public.psi_security_study_posts enable row level security;
revoke all on public.psi_security_study_crime_stats, public.psi_security_study_contacts, public.psi_security_study_posts from public, anon, authenticated;
grant select, insert, update, delete on public.psi_security_study_crime_stats, public.psi_security_study_contacts, public.psi_security_study_posts to service_role;

commit;
