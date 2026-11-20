-- La Torre al entrar (Juan, 2026-11-20): «que al entrar esté al menos cargada la información del último cargue y que se
-- actualice después». Cada cálculo de Avancys (la Torre y la rentabilidad de cada mes) se guarda aquí; la pantalla
-- muestra primero lo guardado, con su hora, y después lo reemplaza por el cálculo en vivo. Antes vivía sólo en la memoria
-- de una instancia de Vercel, que se pierde a cada rato.
-- Sólo el servidor lee y escribe (RLS sin políticas): trae nombres de clientes y cifras de la empresa.

create table if not exists public.siio_torre_guardada (
  clave text primary key check (char_length(clave) between 1 and 80),
  datos jsonb not null,
  medido_en timestamptz not null,
  guardado_en timestamptz not null default now()
);

alter table public.siio_torre_guardada enable row level security;
revoke all on table public.siio_torre_guardada from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_torre_guardada to service_role;
