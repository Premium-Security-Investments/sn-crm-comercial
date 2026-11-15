-- 224 — Mi día de licitaciones: el botón «Hecho» deja constancia.
--
-- Juan Botero, 2026-11-15 (maqueta aprobada: «me gusta, vamos con eso»). Cada acción del día a día de Mi día (radicar
-- observaciones, presentar la oferta, manifestar interés, lo que no se subsana) se marca «Hecho» con quién y cuándo. La
-- clave es la del plazo («oportunidad|tipo|fecha»), así que si el cronograma cambia la fecha, la acción nueva vuelve a
-- salir pendiente. Sólo la escribe el servidor; sin esta tabla, Mi día funciona igual y no ofrece el botón.

begin;

create table if not exists public.psi_tender_mi_dia_hechos (
  item_key text primary key check (char_length(item_key) between 3 and 400),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  done_by uuid references public.psi_sales_profiles(id) on delete set null,
  done_at timestamptz not null default now()
);
create index if not exists psi_tender_mi_dia_hechos_opportunity_idx on public.psi_tender_mi_dia_hechos (opportunity_id);
alter table public.psi_tender_mi_dia_hechos enable row level security;
revoke all on table public.psi_tender_mi_dia_hechos from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.psi_tender_mi_dia_hechos to service_role;

commit;
