-- 203 — Mejora 11 (Juan, 2026-11-10/11): la carpeta de radicación estándar de cada proceso en SharePoint.
--
-- Se crea al registrar el GO (los procesos viejos sólo si alguien lo pide con el botón), con cinco carpetas:
-- 01_Observaciones, 02_Borradores, 03_PARA_RADICAR (con 7 subcarpetas), 04_Radicado y 05_Competidores. La crea el trabajo
-- que ya sube los borradores a SharePoint (nunca sobrescribe, relee lo que escribe). El índice de 03_PARA_RADICAR y la
-- comparación con 04_Radicado se guardan aquí como fotografía y se ven en el CRM: escribirlos como archivo obligaría a
-- sobrescribirlo, y eso no se hace.
begin;

create table if not exists public.psi_tender_filing_folders (
  opportunity_id uuid primary key references public.psi_sales_opportunities(id) on delete cascade,
  status text not null default 'pendiente' check (status in ('pendiente', 'creada', 'error')),
  origin text not null default 'go' check (origin in ('go', 'boton')),
  folder_path text check (folder_path is null or char_length(folder_path) <= 500),
  web_url text check (web_url is null or char_length(web_url) <= 1000),
  error text check (error is null or char_length(error) <= 500),
  requested_by uuid references public.psi_sales_profiles(id) on delete set null,
  refresh_requested_at timestamptz,
  snapshot jsonb,
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists psi_tender_filing_folders_work on public.psi_tender_filing_folders (status, refresh_requested_at);
alter table public.psi_tender_filing_folders enable row level security;
revoke all on table public.psi_tender_filing_folders from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_tender_filing_folders to service_role;

commit;
