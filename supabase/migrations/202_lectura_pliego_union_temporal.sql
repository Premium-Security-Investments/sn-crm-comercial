-- 202 — Aliados según lo que permite el pliego (encargo AGT-002 del 2026-11-10, aprobado por Juan: «sí, vamos con eso»).
--
-- Cuando la recomendación es «Solo en unión temporal», Vig-IA lee el pliego y deja escrito cómo puede cumplir un
-- proponente plural cada requisito que nos falta, con la cita literal:
--   * uno_cumple: un solo integrante debe reunirlo (Fiscalía 5.3.2, punto 1: «si uno de los integrantes cumple…»);
--   * se_suma: se suma entre los integrantes;
--   * no_dice: el pliego no lo dice.
-- Esa lectura decide la lista de «Posibles socios». Una lectura por análisis: si el análisis cambia, se lee de nuevo.
begin;

create table if not exists public.psi_tender_plural_readings (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  analysis_run_id uuid not null,
  mode text not null check (mode in ('uno_cumple', 'se_suma', 'no_dice')),
  quote text check (quote is null or char_length(quote) <= 2000),
  quote_verified boolean not null default false,
  document_id uuid,
  document_name text check (document_name is null or char_length(document_name) <= 300),
  locator text check (locator is null or char_length(locator) <= 200),
  required_cities text[] not null default '{}',
  explanation text check (explanation is null or char_length(explanation) <= 1000),
  created_at timestamptz not null default now(),
  unique (opportunity_id, analysis_run_id)
);
alter table public.psi_tender_plural_readings enable row level security;
revoke all on table public.psi_tender_plural_readings from public, anon, authenticated, service_role;
grant select, insert on table public.psi_tender_plural_readings to service_role;

commit;
