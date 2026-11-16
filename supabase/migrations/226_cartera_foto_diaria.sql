-- 226 — La foto diaria de la cartera, para comparar contra hace un mes (contrato de la Portada aprobado por Juan el
-- 2026-11-15: «Contra hace un mes: la Torre guardará la foto diaria»).
--
-- Avancys no guarda la cartera de fechas pasadas: lo que se pagó ya no figura como abierto. La Torre guarda una fila por
-- día (Bogotá) cada vez que lee la cartera; la del mismo día se reemplaza. Sólo la escribe el servidor; sin esta tabla,
-- la Torre funciona igual y dice que todavía no hay registro.

begin;

create table if not exists public.psi_siio_cartera_fotos (
  fecha date primary key,
  total numeric not null,
  vencido numeric not null,
  mas_30 numeric not null,
  heredado_yeminus numeric,
  tramos jsonb not null default '[]'::jsonb,
  medido_en timestamptz not null default now()
);
alter table public.psi_siio_cartera_fotos enable row level security;
revoke all on table public.psi_siio_cartera_fotos from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.psi_siio_cartera_fotos to service_role;

commit;
