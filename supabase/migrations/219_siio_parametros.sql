-- 219 — Torre de Control: la pestaña «Parámetros» (Juan, 2026-11-13: «todo desde Avancys; lo que deba ingresar una
-- persona va en una pestaña de Parámetros, con encargado, nunca en un Excel»).
--
-- Una fila por versión: guardar un parámetro no pisa el anterior, lo marca como reemplazado. El vigente de cada clave y
-- periodo es el que no tiene `reemplazado_at`. El catálogo (qué es cada clave, su encargado y su forma) vive en
-- verticales/gerencial/siio-parametros.js. Sólo el servidor lee y escribe.
begin;

create table if not exists public.siio_parametros (
  id uuid primary key default gen_random_uuid(),
  clave text not null check (clave in ('presupuesto_rubros', 'metas_mes', 'creditos', 'provision_renta', 'regla_diciembre',
    'aumento_tarifa', 'requisitos_licitaciones', 'ajustes_cierre', 'mapeo_cuentas')),
  -- '2026' para lo anual, '2026-11' para lo mensual, '' para lo que no tiene periodo.
  periodo text not null default '' check (periodo = '' or periodo ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'),
  valor jsonb not null,
  nota text check (nota is null or char_length(nota) <= 500),
  -- «sin_confirmar» para lo sembrado desde un Excel hasta que el encargado lo revise.
  estado text not null default 'confirmado' check (estado in ('confirmado', 'sin_confirmar')),
  creado_por uuid references public.psi_sales_profiles(id) on delete set null,
  creado_por_nombre text,
  creado_at timestamptz not null default now(),
  reemplazado_at timestamptz
);
create unique index if not exists siio_parametros_vigente on public.siio_parametros (clave, periodo) where reemplazado_at is null;
create index if not exists siio_parametros_historial on public.siio_parametros (clave, periodo, creado_at desc);
alter table public.siio_parametros enable row level security;
revoke all on table public.siio_parametros from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_parametros to service_role;

commit;
