-- "Este cliente nuestro es aquel cliente de Avancys": el enlace, confirmado por una persona.
--
-- El NIT no falta —Avancys lo tiene para 1.432 de sus 1.439 clientes—. Lo que faltaba era dónde
-- guardar la correspondencia, así que cada vez que había que relacionar los dos mundos se adivinaba
-- por nombre, y los nombres no coinciden: "PAPELES NACIONALES" aquí, "PAPELES NACIONALES S.A" allá.
--
-- Tabla aparte y no una columna en psi_sales_clients, a propósito. El maestro de clientes lo
-- escribe `psi_persist_sales_opportunity`, que maneja bloqueos, autorización entre comerciales que
-- comparten cliente y nombres duplicados. Meterle un campo obligaría a tocar sus dos ramas, y si
-- eso se rompe se cae crear y editar oportunidades, que es el uso diario del CRM. Esto es aditivo:
-- si sale mal se borra y nada más se entera.
--
-- Un cliente del CRM apunta a un solo cliente de Avancys y al revés: si dos registros del CRM son
-- el mismo cliente de allá, eso es un duplicado del CRM y se arregla allá, no aquí.
begin;

create table if not exists public.psi_cliente_avancys (
  client_id uuid primary key references public.psi_sales_clients(id) on delete cascade,
  avancys_ref_num text not null,
  avancys_nombre text,
  -- Quién lo confirmó: esto no lo decide un algoritmo de parecido, lo decide una persona mirando.
  confirmado_por uuid references public.psi_sales_profiles(id),
  confirmado_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_cliente_avancys_ref_num_unico unique (avancys_ref_num)
);

comment on table public.psi_cliente_avancys is
  'Enlace confirmado por una persona entre un cliente del CRM y uno de Avancys (res.partner.ref_num). No copia datos del cliente: sólo dice que son el mismo.';
comment on column public.psi_cliente_avancys.avancys_ref_num is
  'La identificación en Avancys (res.partner.ref_num), sin dígito de verificación.';

alter table public.psi_cliente_avancys enable row level security;
revoke all on public.psi_cliente_avancys from anon, authenticated, public;
grant select, insert, update, delete on public.psi_cliente_avancys to service_role;

commit;
