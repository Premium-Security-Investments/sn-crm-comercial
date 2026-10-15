-- AGT-001 Vig-IA Gerencia: recomendaciones de IA en la Torre de Control (agt001.executive-recommendations).
-- Decisiones de Juan Botero: 2026-10-11 (lunes + botón, sin chat, útil/no útil, aceptar -> seguimiento) y
-- 2026-10-15 (máximo 3 corridas al día con el botón entre todos los usuarios; la del lunes no cuenta).
-- Aditiva. Solo service_role: la interfaz lee y escribe a través del CRM.

create table if not exists public.siio_ai_recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('boton','semanal')),
  status text not null check (status in ('en_curso','completado','fallido')),
  requested_by uuid references public.psi_sales_profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  bogota_date date not null,
  finished_at timestamptz,
  model text check (model is null or length(model) <= 128),
  summary text check (summary is null or length(summary) <= 600),
  missing_data jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_data) = 'array'),
  sources_as_of jsonb not null default '{}'::jsonb check (jsonb_typeof(sources_as_of) = 'object'),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd_equivalent numeric(12,4),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{1,80}$'),
  constraint siio_ai_recommendation_runs_finished check ((status = 'en_curso') = (finished_at is null))
);

-- Una sola corrida a la vez: el segundo intento choca con este índice y el CRM responde "ya se está generando".
create unique index if not exists siio_ai_recommendation_runs_one_in_progress
  on public.siio_ai_recommendation_runs ((true)) where status = 'en_curso';
create index if not exists siio_ai_recommendation_runs_day
  on public.siio_ai_recommendation_runs (trigger, bogota_date);
create index if not exists siio_ai_recommendation_runs_recent
  on public.siio_ai_recommendation_runs (requested_at desc);

create table if not exists public.siio_ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.siio_ai_recommendation_runs(id) on delete cascade,
  position integer not null check (position between 1 and 10),
  area text not null check (area in ('finanzas','comercial','licitaciones','operaciones','transversal')),
  priority text not null check (priority in ('alta','media','baja')),
  title text not null check (length(btrim(title)) between 5 and 140),
  recommendation text not null check (length(btrim(recommendation)) between 20 and 700),
  rationale text not null check (length(btrim(rationale)) between 20 and 700),
  sources jsonb not null check (jsonb_typeof(sources) = 'array'),
  suggested_owner text not null check (length(btrim(suggested_owner)) between 2 and 80),
  due_in_days integer not null check (due_in_days between 1 and 90),
  feedback text check (feedback is null or feedback in ('util','no_util')),
  feedback_by uuid references public.psi_sales_profiles(id) on delete set null,
  feedback_at timestamptz,
  followup_id uuid references public.siio_followups(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (run_id, position)
);

alter table public.siio_ai_recommendation_runs enable row level security;
alter table public.siio_ai_recommendations enable row level security;
revoke all on table public.siio_ai_recommendation_runs from public, anon, authenticated, service_role;
revoke all on table public.siio_ai_recommendations from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_ai_recommendation_runs to service_role;
grant select, insert, update on table public.siio_ai_recommendations to service_role;
