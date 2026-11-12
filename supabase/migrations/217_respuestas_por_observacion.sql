-- 217 — Las respuestas de la entidad, una por observación (Juan, 2026-11-12, paso 3 del expediente vivo). Las
-- respuestas a observaciones llegan como tablas de dos columnas y el texto extraído intercala lo que pidió el observante
-- con lo que respondió la entidad: la Mesa dijo «se corta» donde decía «NO SE ACOGE» y llamó «otro observante» a
-- Seguridad Nacional. Vig-IA lee cada documento de respuestas una vez y deja aquí cada observación separada: quién,
-- qué pidió, qué decidió la entidad y si es nuestra. La Mesa las recibe ordenadas, las nuestras primero.
begin;

create table if not exists public.psi_agt002_respuestas_observacion (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  document_version_id uuid not null references public.psi_tender_document_versions(id) on delete cascade,
  orden integer not null check (orden >= 1),
  observante text not null check (nullif(btrim(observante), '') is not null and char_length(observante) <= 300),
  es_nuestra boolean not null default false,
  numero text check (numero is null or char_length(numero) <= 60),
  tema text check (tema is null or char_length(tema) <= 300),
  pedido text not null check (nullif(btrim(pedido), '') is not null and char_length(pedido) <= 4000),
  decision text not null check (decision in ('acoge', 'acoge_parcialmente', 'no_acoge', 'aclara', 'otra')),
  respuesta text not null check (nullif(btrim(respuesta), '') is not null and char_length(respuesta) <= 8000),
  cambia_el_pliego text check (cambia_el_pliego is null or char_length(cambia_el_pliego) <= 1000),
  created_at timestamptz not null default now(),
  unique (document_version_id, orden)
);
create index if not exists idx_psi_agt002_respuestas_observacion_opp on public.psi_agt002_respuestas_observacion(opportunity_id);

-- Un documento se lee una vez: aquí queda si se leyó, si no traía respuestas o si falló (y cuántas veces).
create table if not exists public.psi_agt002_respuestas_observacion_docs (
  document_version_id uuid primary key references public.psi_tender_document_versions(id) on delete cascade,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  estado text not null check (estado in ('leido', 'sin_respuestas', 'fallido')),
  intentos integer not null default 1 check (intentos >= 1),
  observaciones integer not null default 0 check (observaciones >= 0),
  error text check (error is null or char_length(error) <= 300),
  updated_at timestamptz not null default now()
);

alter table public.psi_agt002_respuestas_observacion enable row level security;
alter table public.psi_agt002_respuestas_observacion_docs enable row level security;
revoke all on table public.psi_agt002_respuestas_observacion from public, anon, authenticated, service_role;
revoke all on table public.psi_agt002_respuestas_observacion_docs from public, anon, authenticated, service_role;
grant select, insert, delete on table public.psi_agt002_respuestas_observacion to service_role;
grant select, insert, update on table public.psi_agt002_respuestas_observacion_docs to service_role;

commit;
