-- Quién atiende a cada cliente actual: el puente entre el comercial de Avancys y el del CRM.
--
-- Avancys ya trae el reparto hecho: 1.238 de 1.439 clientes tienen comercial asignado
-- (`res.partner.user_id`), medido el 2026-10-28. Lo que no existe es la equivalencia entre ese
-- usuario de Odoo y el perfil del CRM. Esta tabla es esa equivalencia, y nada más.
--
-- No copia clientes. No copia el reparto. El reparto sigue viviendo en Avancys y se lee en vivo;
-- aquí sólo decimos "el usuario 167 de Odoo es Luis Fernando López en el CRM".
--
-- Dos comerciales de Avancys no tienen usuario en el CRM —Verónica Duque, con 310 clientes, y
-- Nina Escobar, con 3—. Por decisión de Juan del 2026-10-28, sus clientes se le muestran a Luis
-- Fernando López, que es el gerente comercial y ya sostiene la cartera de quienes salieron. Eso
-- es lo que expresa `nota`: no es un error de datos, es una decisión, y queda escrita.
--
-- Nada se escribe en Avancys. La credencial de Odoo es de solo lectura por diseño.
begin;

create table if not exists public.psi_avancys_salesperson_map (
  odoo_user_id integer primary key,
  odoo_user_name text not null,
  profile_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.psi_avancys_salesperson_map is
  'Equivalencia entre el comercial de Avancys (res.users) y el perfil del CRM. No guarda el reparto de clientes: ese se lee de Avancys.';
comment on column public.psi_avancys_salesperson_map.nota is
  'Por qué este usuario de Odoo apunta a ese perfil, cuando no es la correspondencia directa.';

-- Un perfil puede recibir varios usuarios de Odoo —Luis Fernando recibe tres— pero un usuario de
-- Odoo no puede apuntar a dos perfiles: eso mostraría los mismos clientes en dos bandejas. Lo
-- garantiza la llave primaria sobre `odoo_user_id`.

insert into public.psi_avancys_salesperson_map (odoo_user_id, odoo_user_name, profile_id, nota)
select v.odoo_user_id, v.odoo_user_name, p.id, v.nota
from (values
  (167, 'LUIS FERNANDO LOPEZ SALAZAR',     'Luis Fernando Lopez',        null),
  (64,  'CARLOS ALBERTO BEDOYA HENAO',     'Carlos Bedoya',              null),
  (62,  'JHON ALEXANDER BERMUDEZ OSORIO',  'Jhon Bermudez',              null),
  (65,  'JOSE JAVIER URIBE BETANCUR',      'Jose Javier Uribe',          null),
  (67,  'JOHN ALEXANDER ESCOBAR VALENCIA', 'John Escobar',               null),
  (48,  'NYDIA VIVIANA ROSAS TORRES',      'Viviana Rosas',              null),
  (75,  'KATERINE VALENCIA BUITRAGO',      'Katherine Valencia Buitrago',null),
  (212, 'LINA MARCELA CARDENAS LOPEZ',     'Lina Cardenas',              null),
  (77,  'VERONICA MARCELA DUQUE MORALES',  'Luis Fernando Lopez',
        'Sin usuario en el CRM. Sus clientes se le muestran al gerente comercial por decisión de Juan, 2026-10-28.'),
  (81,  'NINA YOVANA ESCOBAR HERRERA',     'Luis Fernando Lopez',
        'Sin usuario en el CRM. Sus clientes se le muestran al gerente comercial por decisión de Juan, 2026-10-28.')
) as v(odoo_user_id, odoo_user_name, profile_name, nota)
join public.psi_sales_profiles p on p.full_name = v.profile_name and p.active
on conflict (odoo_user_id) do update
  set odoo_user_name = excluded.odoo_user_name,
      profile_id     = excluded.profile_id,
      nota           = excluded.nota,
      updated_at     = now();

alter table public.psi_avancys_salesperson_map enable row level security;
revoke all on public.psi_avancys_salesperson_map from anon, authenticated, public;
grant select on public.psi_avancys_salesperson_map to service_role;

commit;
