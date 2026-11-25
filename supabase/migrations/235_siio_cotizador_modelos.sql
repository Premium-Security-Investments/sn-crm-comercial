-- Gerencia — Cotizador de modelos de servicio (Juan, 2026-11-25). Vive junto a la Torre de Control.
--
-- Compara lo que un cliente paga hoy por guardas fijos en sus tiendas con un modelo híbrido (guarda solo en las tiendas
-- de mayor riesgo, unidades de reacción y analítica de video). El cálculo lo hace src/siio/modelo-hibrido.js.
--
-- Los datos del cliente son confidenciales (contrato con cláusula de confidencialidad): viven solo aquí, nunca en el
-- código ni en el PR. Se cargan por fuera de la migración, con la fecha de corte y la fuente de cada carga.
--
--   · psi_service_model_stores: una fila por tienda y por carga (corte): zona, nivel de riesgo, puestos de guarda
--     vigentes, valor contratado y merma desconocida. Las cifras en millones de pesos al mes.
--   · psi_service_model_scenarios: supuestos con nombre (precios, proporciones, costos, zonas que entran al modelo).
--     Un escenario puede quedar marcado como el de partida del cliente.
--
-- Permiso de capacidad nuevo `siio_cotizador_modelos`: se marca dentro de la pestaña Torre de Control. Sin él la pantalla
-- no aparece y el servidor responde 403, aunque la persona tenga la Torre.
--
-- Permisos de tabla: sólo el servidor (service_role). RLS encendido sin políticas y `revoke` explícito a anon y
-- authenticated (lección de la 171).
begin;

insert into public.psi_access_permissions(code, name, description, active) values
  ('siio_cotizador_modelos', 'Cotizador de modelos de servicio', 'Ve y usa el cotizador de modelos de servicio de Gerencia (precios, costos y márgenes de clientes).', true)
on conflict (code) do update set name = excluded.name, description = excluded.description, active = true;

create table if not exists public.psi_service_model_stores (
  id uuid primary key default gen_random_uuid(),
  client_key text not null check (length(btrim(client_key)) between 1 and 40),
  cutoff date not null,
  store_code text not null check (length(btrim(store_code)) between 1 and 40),
  store_name text,
  zone text not null check (length(btrim(zone)) between 1 and 80),
  risk_level text not null check (risk_level in ('A', 'B', 'C')),
  new_store boolean not null default false,
  guard_posts integer not null default 0 check (guard_posts >= 0),
  contracted_value numeric(14, 3) not null default 0,
  unknown_shrink numeric(14, 3) not null default 0,
  source text,
  created_at timestamptz not null default now(),
  unique (client_key, cutoff, store_code)
);
create index if not exists psi_service_model_stores_client_idx on public.psi_service_model_stores (client_key, cutoff desc);

create table if not exists public.psi_service_model_scenarios (
  id uuid primary key default gen_random_uuid(),
  client_key text not null check (length(btrim(client_key)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 120),
  params jsonb not null,
  is_baseline boolean not null default false,
  created_by uuid references public.psi_sales_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists psi_service_model_scenarios_client_idx on public.psi_service_model_scenarios (client_key, created_at desc);

alter table public.psi_service_model_stores enable row level security;
alter table public.psi_service_model_scenarios enable row level security;
revoke all on table public.psi_service_model_stores, public.psi_service_model_scenarios from public, anon, authenticated;
grant all on table public.psi_service_model_stores, public.psi_service_model_scenarios to service_role;

commit;
