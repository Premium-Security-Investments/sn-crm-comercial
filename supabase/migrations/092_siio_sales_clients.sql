begin;

-- SIIO sales client master (migration 092): introduces public.psi_sales_clients as the single
-- source of truth for client/company identity, deduplicated by a normalized company name
-- (trim + collapsed whitespace + lowercase). public.psi_sales_opportunities gains a nullable
-- client_id FK (ON DELETE RESTRICT) back to it.
--
-- Seeding is scoped to private business only: any opportunity with
-- service_type_code = 'licitacion_publica' is excluded from the seed and never gets a
-- client_id. If any normalized company name mixes licitacion_publica and private
-- opportunities, this migration aborts (RAISE EXCEPTION) rather than guess which side is
-- authoritative. No row of psi_sales_opportunities is ever deleted by this migration.

create table if not exists public.psi_sales_clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  customer_segment text,
  regional_nombre text,
  sede text,
  quote_city text,
  economic_sector text,
  decision_maker_name text,
  decision_maker_email text,
  decision_maker_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists psi_sales_clients_normalized_name_key
  on public.psi_sales_clients (lower(regexp_replace(trim(company_name), '\s+', ' ', 'g')));

alter table public.psi_sales_opportunities
  add column if not exists client_id uuid references public.psi_sales_clients(id) on delete restrict;

-- Fail closed: refuse to seed if any normalized company name mixes licitacion_publica and
-- private opportunities, since there would be no safe way to pick one client identity for it.
do $$
declare
  v_mixed_name text;
begin
  select lower(regexp_replace(trim(company_name), '\s+', ' ', 'g'))
    into v_mixed_name
  from public.psi_sales_opportunities
  group by 1
  having count(*) filter (where service_type_code = 'licitacion_publica') > 0
     and count(*) filter (where service_type_code is distinct from 'licitacion_publica') > 0
  limit 1;

  if v_mixed_name is not null then
    raise exception 'el nombre normalizado "%" mezcla oportunidades licitacion_publica y privadas: no se puede seleccionar un cliente unico', v_mixed_name;
  end if;
end
$$;

-- Seed: one client per normalized private company name, taken from that name's newest
-- opportunity row. licitacion_publica opportunities are excluded entirely.
insert into public.psi_sales_clients (
  company_name, customer_segment, regional_nombre, sede, quote_city, economic_sector,
  decision_maker_name, decision_maker_email, decision_maker_phone, created_at, updated_at
)
select distinct on (lower(regexp_replace(trim(o.company_name), '\s+', ' ', 'g')))
  o.company_name, o.customer_segment, o.regional_nombre, o.sede, o.quote_city, o.economic_sector,
  o.decision_maker_name, o.decision_maker_email, o.decision_maker_phone, o.created_at, o.updated_at
from public.psi_sales_opportunities o
where o.service_type_code is distinct from 'licitacion_publica'
order by lower(regexp_replace(trim(o.company_name), '\s+', ' ', 'g')),
  coalesce(o.updated_at, o.created_at) desc,
  o.id desc;

-- Backfill client_id on private opportunities only, matched by normalized company name.
-- licitacion_publica opportunities keep client_id null.
update public.psi_sales_opportunities o
set client_id = c.id
from public.psi_sales_clients c
where o.service_type_code is distinct from 'licitacion_publica'
  and lower(regexp_replace(trim(o.company_name), '\s+', ' ', 'g'))
    = lower(regexp_replace(trim(c.company_name), '\s+', ' ', 'g'));

commit;
