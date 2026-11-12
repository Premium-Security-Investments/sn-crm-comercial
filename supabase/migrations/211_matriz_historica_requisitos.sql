-- 211 — La matriz histórica de requisitos en una tabla (Juan, 2026-11-12: «vaya con la tabla»).
--
-- El Excel sigue en SharePoint (06_Productos_PSI/Licitaciones/01_Base_Maestra_y_Taxonomia/01_Bases_de_datos_historica/
-- Matriz_Historica_Requisitos_Habilitantes_y_Puntuables.xlsx) y es la fuente. El puente diario de SharePoint lo baja,
-- lo limpia (verticales/licitaciones/requirement-history-import.js) y lo deja aquí, una fila por ocurrencia de las hojas
-- Habilitantes y Puntuables. La pestaña «Requisitos» la lee para el catálogo histórico. Nadie la edita a mano: lo que
-- se corrija, se corrige en el Excel.
begin;

create table if not exists public.psi_tender_requirement_history (
  id text primary key check (char_length(id) between 1 and 40),
  kind text not null check (kind in ('habilitante', 'puntuable')),
  categoria text check (categoria is null or char_length(categoria) <= 80),
  requisito text not null check (char_length(requisito) <= 500),
  umbral text check (umbral is null or char_length(umbral) <= 300),
  puntos text check (puntos is null or char_length(puntos) <= 20),
  cita text check (cita is null or char_length(cita) <= 400),
  procesos text[] not null default '{}',
  url text check (url is null or char_length(url) <= 500),
  source_modified_at timestamptz,
  loaded_at timestamptz not null default now()
);
alter table public.psi_tender_requirement_history enable row level security;
revoke all on table public.psi_tender_requirement_history from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.psi_tender_requirement_history to service_role;

commit;
