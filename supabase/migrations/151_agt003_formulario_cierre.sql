-- AGT-003 Vig-IA Comercial — el formulario de cierre vive en el CRM (Juan, 2026-10-23).
--
-- Hoy, cuando un comercial cierra un negocio nuevo, llena el formato GGC-FO-001 ("Nuevo puesto de vigilancia
-- física", versión 18) en Word y lo manda por correo; con eso operaciones monta los puestos, facturación factura y
-- monitoreo se entera. Ese Word es el ÚNICO lugar donde hoy conviven el cliente, los puestos y el valor, y viaja
-- por fuera del sistema: sin traza, con las sumas hechas a mano (el ejemplar revisado el 2026-10-23 traía el TOTAL
-- descuadrado en 23,7 millones) y con siete firmas en blanco.
--
-- Decisión de Juan: el formulario pasa a vivir aquí, se autocompleta con lo que el CRM ya sabe, el comercial llena
-- el resto, y **sólo se podrá marcar el negocio como ganado cuando esté completo**. La entrega a las demás áreas
-- será por Avancys cuando esa conexión exista; esta migración no la supone.
--
-- Tres tablas, porque el formulario tiene tres partes de distinta cardinalidad:
--   · `psi_sales_closure_forms`   — una por oportunidad (cabecera: cliente, contratación, facturación, vigencia).
--   · `psi_sales_closure_form_sites` — las direcciones donde se presta el servicio (varias por formulario).
--   · `psi_sales_closure_form_posts` — los puestos vendidos (varios por formulario). Es la parte que hoy no existe
--     en ninguna tabla del CRM: el CRM cierra con UN número (`offer_value`) y el negocio se cierra con una
--     estructura (N puestos × horario × vigilantes × armado × valor).
--
-- El dinero NO se guarda sumado: se guardan los valores por puesto y el AIU, y subtotal/IVA/total se calculan
-- (`src/vigia/closure-form.js`). Así el defecto del Word —una suma a mano que no cuadra— no se puede repetir.
--
-- Las tablas las lee y escribe sólo el servidor (`service_role`), como todo el frente comercial desde la 112.
-- Aditiva: ninguna oportunidad existente cambia y nada se bloquea por esta migración sola.
begin;

create table if not exists public.psi_sales_closure_forms (
  id uuid primary key default gen_random_uuid(),
  -- Una oportunidad, un formulario. Si la oportunidad se borra, el formulario se va con ella.
  opportunity_id uuid not null unique references public.psi_sales_opportunities(id) on delete cascade,
  -- `completo` lo decide la regla de completitud del servidor, no el usuario escribiendo un estado.
  status text not null default 'borrador' check (status in ('borrador', 'completo')),

  -- Quién autorizó el servicio del lado del cliente (se autocompleta con el decisor de la oportunidad).
  authorized_by_name text,
  authorized_by_title text,

  -- Contratar y facturar pueden ser dos razones sociales distintas, con dos NIT. El CRM guardaba una sola.
  contracting_company_name text,
  contracting_company_nit text,
  billing_company_name text,
  billing_company_nit text,
  -- El sitio puede llamarse distinto del cliente: "Hotel Hilton Pereira" contra "Bansuri Hotel Group S.A.S.".
  establishment_name text,

  sector text,
  residential_stratum text,
  ciiu_code text,
  contact_email text,
  contact_phones text,

  legal_rep_name text,
  legal_rep_id_number text,
  legal_rep_id_issued_at text,

  withholding_agent boolean,
  tax_regime text check (tax_regime is null or tax_regime in ('simplificado', 'comun')),
  large_taxpayer boolean,

  contract_mail_address text,
  einvoice_email text,
  payment_contact_name text,
  payment_contact_title text,
  payment_terms text,
  operational_supervisor text,

  -- Vigencia de lo vendido. El CRM tenía la fecha estimada de cierre de la VENTA, no la del SERVICIO.
  service_start_date date,
  service_end_date date,
  visit_officer_name text,
  service_mode text check (service_mode is null or service_mode in ('fija', 'movil')),
  complementary_notes text,
  loaned_equipment_notes text,
  -- AIU informativo del contrato. El IVA del 19 % se calcula sobre este valor, no sobre el servicio.
  aiu_value numeric(14, 2) check (aiu_value is null or aiu_value >= 0),

  created_by uuid references public.psi_sales_profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.psi_sales_profiles(id),
  updated_at timestamptz not null default now(),
  completed_by uuid references public.psi_sales_profiles(id),
  completed_at timestamptz,
  constraint psi_sales_closure_forms_dates check (service_end_date is null or service_start_date is null or service_end_date > service_start_date),
  constraint psi_sales_closure_forms_completo check (status <> 'completo' or completed_at is not null)
);

create table if not exists public.psi_sales_closure_form_sites (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.psi_sales_closure_forms(id) on delete cascade,
  address text not null check (length(btrim(address)) between 5 and 400),
  city text not null check (length(btrim(city)) between 2 and 80),
  phone text,
  contact_name text,
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now()
);

create index if not exists psi_sales_closure_form_sites_form on public.psi_sales_closure_form_sites (form_id, position);

create table if not exists public.psi_sales_closure_form_posts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.psi_sales_closure_forms(id) on delete cascade,
  -- Qué se vende: "vigilante para el acceso principal, con servicio 24/7".
  description text not null check (length(btrim(description)) between 3 and 500),
  -- El horario se guarda como dos horas, no como el texto "6:00 A 6:00": el 24/7 dejó de ser algo que hay que
  -- deducir leyendo "3 vigilantes" al lado de un rango que empieza y termina a la misma hora.
  shift_start time,
  shift_end time,
  -- Días de prestación en el mes. En el Word el rótulo era ambiguo ("DIAS PRESTACIÓN DE SERVICIO: 30").
  days_per_month integer check (days_per_month is null or days_per_month between 1 and 31),
  guards_required integer not null check (guards_required between 1 and 50),
  armed boolean not null default false,
  monthly_value numeric(14, 2) not null check (monthly_value >= 0),
  notes text,
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now()
);

create index if not exists psi_sales_closure_form_posts_form on public.psi_sales_closure_form_posts (form_id, position);

alter table public.psi_sales_closure_forms enable row level security;
alter table public.psi_sales_closure_form_sites enable row level security;
alter table public.psi_sales_closure_form_posts enable row level security;

revoke all on table public.psi_sales_closure_forms from public, anon, authenticated;
revoke all on table public.psi_sales_closure_form_sites from public, anon, authenticated;
revoke all on table public.psi_sales_closure_form_posts from public, anon, authenticated;

grant select, insert, update, delete on table public.psi_sales_closure_forms to service_role;
grant select, insert, update, delete on table public.psi_sales_closure_form_sites to service_role;
grant select, insert, update, delete on table public.psi_sales_closure_form_posts to service_role;

comment on table public.psi_sales_closure_forms is
  'Formulario de cierre de un negocio nuevo (formato GGC-FO-001 v18), uno por oportunidad. Reemplaza el Word que el comercial mandaba por correo. Sólo con el formulario completo se puede marcar la oportunidad como ganada.';
comment on table public.psi_sales_closure_form_sites is
  'Direcciones donde se presta el servicio vendido. Son varias y no coinciden necesariamente con la dirección de facturación.';
comment on table public.psi_sales_closure_form_posts is
  'Puestos vendidos: horario, vigilantes, armado y valor mensual de cada uno. Es la estructura del negocio que antes sólo existía dibujada en el Word, y lo que le falta a programacion.puestos para poder calcular rentabilidad por cliente.';
comment on column public.psi_sales_closure_forms.aiu_value is
  'AIU informativo del contrato. El IVA del 19 % va sobre el AIU, no sobre el valor del servicio; subtotal, IVA y total se CALCULAN y no se guardan.';

commit;
