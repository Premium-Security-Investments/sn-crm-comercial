-- A quién se le provisiona el mes: la lista declarada, con dueño humano.
--
-- Regla de Contabilidad, 2026-10-29: los únicos con condición de mes vencido son los clientes
-- públicos; a los demás se les factura actualizado. A esos se les registra el servicio del mes
-- aunque la factura salga el mes siguiente, y en diciembre se hacen dos facturaciones para
-- completar las doce del año.
--
-- Por qué esta lista existe: Avancys NO sabe cuál cliente es público. Medido el 2026-10-29. Sus
-- etiquetas separan ciclos de facturación —1.163 en un grupo y 242 en el otro— y los clientes
-- provisionados en agosto están todos en el segundo, pero también lo está el cliente más grande
-- de la compañía, que no se provisiona. La etiqueta es condición necesaria y no suficiente, y el
-- campo de personería sólo distingue natural de jurídica.
--
-- Así que esto no se deduce: se declara. Juan, 2026-10-29: "normalmente sí son los mismos […] y si
-- algo pongamos la opción en la plataforma de adicionar o eliminar en un caso concreto".
--
-- La tabla nace VACÍA a propósito. Las filas son nombres e identificaciones de clientes: son datos
-- de la empresa y no van en el repositorio. Se marcan desde la plataforma, que además es lo que
-- deja escrito quién lo decidió.
begin;

create table if not exists public.psi_cliente_provision (
  avancys_ref_num text primary key,
  avancys_nombre text,
  -- `false` no borra la fila: deja constancia de que alguien lo quitó, y cuándo.
  activo boolean not null default true,
  nota text,
  marcado_por uuid references public.psi_sales_profiles(id),
  marcado_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.psi_cliente_provision is
  'Clientes a los que se les provisiona el servicio del mes (facturacion mes vencido). Declarado por una persona: Avancys no distingue al cliente publico.';

alter table public.psi_cliente_provision enable row level security;
revoke all on public.psi_cliente_provision from anon, authenticated, public;
grant select, insert, update, delete on public.psi_cliente_provision to service_role;

commit;
