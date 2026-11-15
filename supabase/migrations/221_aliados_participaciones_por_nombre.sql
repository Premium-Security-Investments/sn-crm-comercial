-- 221 — Aliados: unir a su empresa las participaciones que se cargaron sin NIT.
--
-- Juan Botero, 2026-11-15 («vamos con 1»). Diez participaciones de siete empresas que sí están en la base (AMCOVIT,
-- Serviconfor, Seguridad Camaleón, Éxito de Colombia, Récord, Trébol y VIPCOL) se cargaron el 14-nov con el nombre
-- del acta y sin NIT, y por eso no salen en la ficha de esas empresas. Las participaciones son de sólo agregar (196): no
-- se editan. La corrección es una tabla aparte, «este nombre es esta empresa», que la pantalla aplica al leer, sin tocar
-- el registro original. Sólo la escribe el servidor.

begin;

create table if not exists public.psi_vigilance_participation_links (
  company_label text primary key check (char_length(btrim(company_label)) between 2 and 300),
  nit text not null references public.psi_vigilance_companies(nit) on delete cascade,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists psi_vigilance_participation_links_nit_idx on public.psi_vigilance_participation_links (nit);
alter table public.psi_vigilance_participation_links enable row level security;
revoke all on table public.psi_vigilance_participation_links from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_vigilance_participation_links to service_role;

commit;
