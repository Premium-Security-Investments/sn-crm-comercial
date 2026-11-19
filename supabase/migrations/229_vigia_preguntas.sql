-- AGT-001 «Pregúntele a Vig-IA» (pestaña Vig-IA de la Torre). Decisiones de Juan, 2026-11-19:
--   * lo usa todo perfil con acceso a la Torre;
--   * ve datos completos (nombres, cédulas, salarios);
--   * cada persona ve SOLO sus preguntas y respuestas;
--   * Vig-IA aprende: guarda dónde encontró cada dato y qué hay que saber de él (siio_vigia_conocimiento), y el
--     administrador ve qué se pregunta más, sin las respuestas.
--
-- Las dos tablas son solo del servidor: RLS activo y sin políticas. La API filtra por el perfil que pregunta y el
-- trabajador del servidor (ops/agt001-preguntas) escribe las respuestas con la llave de servicio.

create table if not exists public.siio_vigia_preguntas (
  id uuid primary key default gen_random_uuid(),
  asked_by uuid not null references public.psi_sales_profiles(id) on delete cascade,
  question text not null check (char_length(question) between 3 and 600),
  parent_id uuid references public.siio_vigia_preguntas(id) on delete set null,
  status text not null default 'pendiente' check (status in ('pendiente', 'leyendo', 'respondida', 'fallida')),
  answer jsonb,
  answer_table jsonb,
  failure_code text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  model text,
  num_turns integer,
  duration_ms integer
);

create index if not exists siio_vigia_preguntas_por_persona on public.siio_vigia_preguntas (asked_by, requested_at desc);
create index if not exists siio_vigia_preguntas_pendientes on public.siio_vigia_preguntas (requested_at) where status = 'pendiente';

create table if not exists public.siio_vigia_conocimiento (
  id uuid primary key default gen_random_uuid(),
  topic_key text not null unique,
  topic text not null check (char_length(topic) between 2 and 160),
  note text not null check (char_length(note) between 3 and 800),
  learned_from uuid references public.siio_vigia_preguntas(id) on delete set null,
  uses integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.siio_vigia_preguntas enable row level security;
alter table public.siio_vigia_conocimiento enable row level security;
revoke all on table public.siio_vigia_preguntas from public, anon, authenticated, service_role;
revoke all on table public.siio_vigia_conocimiento from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_vigia_preguntas to service_role;
grant select, insert, update on table public.siio_vigia_conocimiento to service_role;
