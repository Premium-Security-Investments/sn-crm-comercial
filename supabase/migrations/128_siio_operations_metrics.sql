-- AGT-004 / Vig-IA Operaciones → Torre de Gerencia: cifras mensuales de Operaciones por cliente.
-- Decisión de Juan 2026-10-14: empezar la rentabilidad por cliente con ARA; lo importante es
-- empezar a tener datos de Operaciones y afinar después.
-- Solo cifras agregadas (conteos por cliente, regional y mes). Nada de personas: ni nombres,
-- ni cédulas, ni correos, ni GPS, ni placas. Cada extracción es una corrida inmutable; la Torre
-- lee la última corrida completa.
-- Source-only migration. Applying it to any remote environment requires a separate gate.

insert into public.siio_sources
  (id, name, source_type, related_fronts, owner, responsible_area, trust_level, status, permissions, allowed_agent_use, restrictions, update_frequency)
values
  (
    'SRC-OPS-SECURITYOPS',
    'SecurityOps (Firestore security-ops-e8534)',
    'Sistema operativo / base de datos',
    array[]::text[],
    'Vig-IA Operaciones (AGT-004)',
    'Operaciones',
    'referencia',
    'activa',
    'Lectura de solo conteos; Gerencia consume agregados publicados por Vig-IA Operaciones',
    'Vig-IA Operaciones extrae agregados; Vig-IA Gerencia los consume',
    'Sin datos personales. El cliente del puesto se deduce por nombre/SAP/zona hasta que SecurityOps tenga ID de cliente.',
    'bajo demanda (diaria cuando exista cuenta de servicio)'
  )
on conflict (id) do update set
  name = excluded.name,
  source_type = excluded.source_type,
  owner = excluded.owner,
  responsible_area = excluded.responsible_area,
  trust_level = excluded.trust_level,
  restrictions = excluded.restrictions,
  update_frequency = excluded.update_frequency;

create table if not exists public.siio_operations_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.siio_sources(id) on delete restrict,
  extracted_at timestamptz not null,
  extractor_version text not null check (length(btrim(extractor_version)) between 1 and 40),
  client_rule text not null check (length(btrim(client_rule)) between 1 and 500),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  loaded_at timestamptz not null default now()
);

create table if not exists public.siio_operations_metrics (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.siio_operations_runs(id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  client_key text not null check (client_key ~ '^[a-z0-9_]{1,40}$'),
  client_label text not null check (length(btrim(client_label)) between 1 and 120),
  regional text not null default 'TODAS' check (length(btrim(regional)) between 1 and 60),
  metric text not null check (metric in (
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
    'rondas'
  )),
  value numeric not null check (value >= 0),
  data_quality text not null default 'aproximado' check (data_quality in ('aproximado','confirmado')),
  unique (run_id, period_month, client_key, regional, metric)
);

create index if not exists siio_operations_metrics_lookup_idx
  on public.siio_operations_metrics (client_key, period_month, metric);

-- La Torre lee siempre la última corrida cargada.
create or replace view public.siio_operations_metrics_current
with (security_invoker = true) as
select m.period_month, m.client_key, m.client_label, m.regional, m.metric, m.value, m.data_quality,
       r.extracted_at, r.source_id
from public.siio_operations_metrics m
join public.siio_operations_runs r on r.id = m.run_id
where r.id = (select id from public.siio_operations_runs order by extracted_at desc, loaded_at desc limit 1);

alter table public.siio_operations_runs enable row level security;
alter table public.siio_operations_metrics enable row level security;
revoke all on table public.siio_operations_runs from public, anon, authenticated, service_role;
revoke all on table public.siio_operations_metrics from public, anon, authenticated, service_role;
revoke all on table public.siio_operations_metrics_current from public, anon, authenticated, service_role;
grant select on table public.siio_operations_runs to service_role;
grant select on table public.siio_operations_metrics to service_role;
grant select on table public.siio_operations_metrics_current to service_role;
