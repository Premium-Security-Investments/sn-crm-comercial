-- AGT-003 — Cotizador: tarifas con vigencia y cotizaciones guardadas (Juan, 2026-11-10 y 2026-11-11). Entrega 2 de 5.
--
-- Tarifas: la Superintendencia publica a más tardar el 31 de diciembre el factor y los porcentajes del año siguiente.
-- Cada juego de tarifas se guarda con la fecha desde la que rige; el vigente para un día es el de `valid_from` más
-- reciente que no sea posterior a ese día. Nada se sobrescribe: las de 2026 quedan como historia cuando entren las de
-- 2027. Los valores se validan en el servidor (`normalizeGuardRates` / `normalizeTechRates` de quote-engine.js).
--
-- Cotizaciones: una cotización puede llevar puestos de vigilancia y líneas de tecnología a la vez (decisión de Juan).
-- Se puede hacer sin oportunidad (cotización rápida desde el menú) y ligarla después. El dinero NO se guarda: lo calcula
-- el motor. Lo que se guarda es la copia de las tarifas con que se cotizó (`guard_rates`, `tech_rates`), para que una
-- propuesta enviada se pueda rehacer igual aunque las tarifas cambien.
--
-- Permisos: sólo el servidor (service_role). RLS encendido sin políticas y `revoke` explícito a anon y authenticated,
-- porque Supabase les da permisos por omisión en las tablas nuevas de `public` (lección de la 171).
begin;

create table if not exists public.psi_quote_rates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('vigilancia', 'tecnologia')),
  valid_from date not null,
  params jsonb not null,
  notes text,
  created_by uuid references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  unique (kind, valid_from)
);

create table if not exists public.psi_quotes (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
  client_name text,
  title text,
  status text not null default 'borrador' check (status in ('borrador', 'enviada', 'aceptada', 'descartada')),
  guard_rates jsonb,
  tech_rates jsonb,
  created_by uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists psi_quotes_opportunity_idx on public.psi_quotes (opportunity_id);
create index if not exists psi_quotes_created_by_idx on public.psi_quotes (created_by, created_at desc);

create table if not exists public.psi_quote_guard_posts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.psi_quotes(id) on delete cascade,
  position integer not null,
  name text,
  start_time text not null,
  end_time text not null,
  day_types text[] not null,
  guards integer not null check (guards between 1 and 50),
  modality text not null check (modality in ('sin_arma', 'con_arma', 'canino'))
);
create index if not exists psi_quote_guard_posts_quote_idx on public.psi_quote_guard_posts (quote_id, position);

create table if not exists public.psi_quote_tech_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.psi_quotes(id) on delete cascade,
  position integer not null,
  description text,
  category text not null check (category in ('equipo', 'insumo', 'mano_de_obra')),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0)
);
create index if not exists psi_quote_tech_lines_quote_idx on public.psi_quote_tech_lines (quote_id, position);

alter table public.psi_quote_rates enable row level security;
alter table public.psi_quotes enable row level security;
alter table public.psi_quote_guard_posts enable row level security;
alter table public.psi_quote_tech_lines enable row level security;

revoke all on table public.psi_quote_rates, public.psi_quotes, public.psi_quote_guard_posts, public.psi_quote_tech_lines from public, anon, authenticated;
grant all on table public.psi_quote_rates, public.psi_quotes, public.psi_quote_guard_posts, public.psi_quote_tech_lines to service_role;

-- Tarifas de 2026 (respuestas del área de tarifas y de Juan, 2026-11-11). Los tres periodos del factor quedan como
-- historia; el vigente hoy es 10,21 desde el 15 de julio.
insert into public.psi_quote_rates (kind, valid_from, params, notes) values
  ('vigilancia', date '2026-01-01', jsonb_build_object('smlmv', 1750905, 'factor', 9.77, 'dayShare', 0.4759, 'nightShare', 0.5241, 'dayStartHour', 6, 'dayEndHour', 19,
     'modalities', jsonb_build_object('sin_arma', 0.08, 'con_arma', 0.10, 'canino', 0.11), 'lifeInsurancePerGuard', 500, 'aiuRate', 0.10, 'ivaRate', 0.19),
   'Superintendencia, enero a junio de 2026 (cargue inicial)'),
  ('vigilancia', date '2026-07-01', jsonb_build_object('smlmv', 1750905, 'factor', 9.85, 'dayShare', 0.4759, 'nightShare', 0.5241, 'dayStartHour', 6, 'dayEndHour', 19,
     'modalities', jsonb_build_object('sin_arma', 0.08, 'con_arma', 0.10, 'canino', 0.11), 'lifeInsurancePerGuard', 500, 'aiuRate', 0.10, 'ivaRate', 0.19),
   'Superintendencia, 1 al 14 de julio de 2026 (cargue inicial)'),
  ('vigilancia', date '2026-07-15', jsonb_build_object('smlmv', 1750905, 'factor', 10.21, 'dayShare', 0.4759, 'nightShare', 0.5241, 'dayStartHour', 6, 'dayEndHour', 19,
     'modalities', jsonb_build_object('sin_arma', 0.08, 'con_arma', 0.10, 'canino', 0.11), 'lifeInsurancePerGuard', 500, 'aiuRate', 0.10, 'ivaRate', 0.19),
   'Superintendencia, desde el 15 de julio de 2026 (cargue inicial; vigente según Juan el 2026-11-10)'),
  ('tecnologia', date '2026-01-01', jsonb_build_object('margin', 0.35, 'ivaRate', 0.19),
   'Margen del 35 % para todo (Juan, 2026-11-11)')
on conflict (kind, valid_from) do nothing;

commit;
