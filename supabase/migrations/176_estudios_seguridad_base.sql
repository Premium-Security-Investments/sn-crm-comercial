-- Estudios de Seguridad Física, tramo 1: registrar un estudio en SIIO (Juan, 2026-11-05).
--
-- Hoy cada estudio es un Excel de 31 hojas que alguien copia del anterior, llena a mano y convierte en Word. Los tres
-- revisados el 2026-11-04 (Cancha Horizontes, HADA International, EXCO Colombiana) traen tres fórmulas distintas,
-- filas fantasma, nombres de otros clientes y un valor tecleado encima de la fórmula
-- (docs/plans/2026-11-04-estudios-seguridad-fisica-mvp.md). Decisión de Juan: quien hace el estudio lo registra
-- aquí, desde la pantalla o con un agente de texto, y el estudio se genera; los Excel no se importan ni siguen.
--
-- Lo que NO se guarda:
--   · Clientes, sedes, puestos ni contratos: vienen de Avancys, de Programación o de la oportunidad del CRM. El
--     estudio guarda la referencia y una copia del nombre al momento de elegirlo, para que el informe no cambie si
--     la fuente cambia después.
--   · Resultados del cálculo. Se guardan los insumos (probabilidad, impactos, calificación de controles) y el
--     servidor calcula con la metodología del estudio (`verticales/estudios-seguridad/metodologia.js`). Así nadie
--     puede escribir un nivel encima de la fórmula, que es el defecto de EXCO R3.
--
-- Cuatro tablas, por cardinalidad: estudio → zonas → riesgos → acciones. Las evidencias (fotos) llegan en el
-- siguiente tramo. Como el resto del SIIO desde la 112, sólo el servidor (`service_role`) lee y escribe.
-- Aditiva: no toca ninguna tabla existente salvo el catálogo de permisos.
begin;

insert into public.psi_access_permissions(code, name, description, active)
values ('estudios_seguridad', 'Estudios de Seguridad', 'Acceso al módulo de Estudios de Seguridad Física: registrar zonas, riesgos, controles y acciones.', true)
on conflict (code) do update set name = excluded.name, description = excluded.description, active = true;

create sequence if not exists public.psi_security_study_number_seq;
revoke all on sequence public.psi_security_study_number_seq from public, anon, authenticated;
grant usage, select on sequence public.psi_security_study_number_seq to service_role;

create table if not exists public.psi_security_studies (
  id uuid primary key default gen_random_uuid(),
  -- Código legible para el informe y para hablar del estudio ("EST-2026-0007").
  code text not null unique default ('EST-' || to_char(now() at time zone 'America/Bogota', 'YYYY') || '-' || lpad(nextval('public.psi_security_study_number_seq')::text, 4, '0')),
  title text not null check (length(btrim(title)) between 3 and 200),
  template_id text not null default 'instalaciones-fisicas-v1',
  -- La metodología con que se calcula. Un estudio aprobado conserva la suya aunque salga una versión nueva.
  methodology_id text not null default 'instalaciones-fisicas-v1',
  status text not null default 'borrador'
    check (status in ('borrador', 'en_revision', 'devuelto', 'revisado', 'aprobado', 'archivado')),

  -- Cliente: referencia a la fuente dueña del dato + copia del nombre al elegirlo.
  client_source text not null check (client_source in ('avancys', 'crm')),
  client_ref text not null check (length(btrim(client_ref)) between 1 and 80),
  client_name text not null check (length(btrim(client_name)) between 2 and 200),
  client_nit text,
  opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,

  -- Sede: un puesto de Avancys, la sede del CRM, o escrita a mano sólo cuando la fuente no la tiene (prospecto).
  site_source text not null check (site_source in ('avancys_puesto', 'crm', 'manual')),
  site_ref text,
  site_name text not null check (length(btrim(site_name)) between 2 and 200),
  site_city text,
  site_address text,
  constraint psi_security_studies_site_ref_required check (site_source = 'manual' or site_ref is not null),

  scope text,
  visit_date date,
  prepared_by uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.psi_security_studies is 'Estudio de seguridad física. Cliente y sede son referencias a Avancys, Programación o el CRM; ver migración 176.';

create table if not exists public.psi_security_study_zones (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  -- El "escenario físico" del Excel: portería, bodega 3, perímetro norte.
  name text not null check (length(btrim(name)) between 2 and 160),
  description text,
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_security_study_zones_name_unique unique (study_id, name)
);

create table if not exists public.psi_security_study_risks (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  zone_id uuid references public.psi_security_study_zones(id) on delete set null,
  -- Número dentro del estudio (R1, R2…). Lo asigna el servidor: el siguiente al mayor que exista.
  number integer not null check (number > 0),
  -- Del catálogo de la plantilla (verticales/estudios-seguridad/plantilla.js) cuando aplica; null si es propio.
  catalog_risk_code text,
  process_code text,
  title text not null check (length(btrim(title)) between 3 and 300),
  causes text,
  consequences text,
  probability smallint not null check (probability between 1 and 5),
  impact_company smallint not null check (impact_company between 1 and 5),
  impact_people smallint not null check (impact_people between 1 and 5),

  -- Control existente: o se califica completo o no se califica.
  current_control text,
  current_quality smallint check (current_quality between 1 and 5),
  current_efficacy smallint check (current_efficacy between 1 and 5),
  current_efficiency smallint check (current_efficiency between 1 and 5),
  constraint psi_security_study_risks_current_rating_complete check (
    (current_quality is null and current_efficacy is null and current_efficiency is null)
    or (current_quality is not null and current_efficacy is not null and current_efficiency is not null)
  ),
  -- Control propuesto (lo que se recomienda); de él sale el riesgo residual.
  proposed_control text,
  proposed_quality smallint check (proposed_quality between 1 and 5),
  proposed_efficacy smallint check (proposed_efficacy between 1 and 5),
  proposed_efficiency smallint check (proposed_efficiency between 1 and 5),
  constraint psi_security_study_risks_proposed_rating_complete check (
    (proposed_quality is null and proposed_efficacy is null and proposed_efficiency is null)
    or (proposed_quality is not null and proposed_efficacy is not null and proposed_efficiency is not null)
  ),

  -- Cómo entró: escrito en la pantalla o propuesto por el agente de texto y confirmado por una persona.
  origin text not null default 'manual' check (origin in ('manual', 'agente')),
  created_by uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_security_study_risks_number_unique unique (study_id, number)
);

create table if not exists public.psi_security_study_actions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  risk_id uuid not null references public.psi_security_study_risks(id) on delete cascade,
  description text not null check (length(btrim(description)) between 3 and 1000),
  -- Responsable escrito por nombre, como en Seguimiento gerencial: puede ser del cliente.
  owner_label text check (owner_label is null or length(btrim(owner_label)) between 2 and 120),
  due_date date,
  priority text not null default 'media' check (priority in ('alta', 'media', 'baja')),
  status text not null default 'pendiente' check (status in ('pendiente', 'en_curso', 'cumplida', 'descartada')),
  created_by uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists psi_security_studies_prepared_by_idx on public.psi_security_studies(prepared_by);
create index if not exists psi_security_study_zones_study_idx on public.psi_security_study_zones(study_id);
create index if not exists psi_security_study_risks_study_idx on public.psi_security_study_risks(study_id);
create index if not exists psi_security_study_actions_study_idx on public.psi_security_study_actions(study_id);
create index if not exists psi_security_study_actions_risk_idx on public.psi_security_study_actions(risk_id);

alter table public.psi_security_studies enable row level security;
alter table public.psi_security_study_zones enable row level security;
alter table public.psi_security_study_risks enable row level security;
alter table public.psi_security_study_actions enable row level security;

revoke all on public.psi_security_studies, public.psi_security_study_zones, public.psi_security_study_risks, public.psi_security_study_actions
  from public, anon, authenticated;
grant select, insert, update, delete on public.psi_security_studies, public.psi_security_study_zones, public.psi_security_study_risks, public.psi_security_study_actions
  to service_role;

commit;
