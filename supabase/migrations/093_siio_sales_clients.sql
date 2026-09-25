begin;

-- SIIO sales client master (migration 092): private-client source of truth.
-- No row of public.psi_sales_opportunities is deleted by this migration.

-- Canonical trim + whitespace collapse + lowercase. The character set mirrors JavaScript \s,
-- including NBSP, tabs, newlines and the Unicode whitespace code points used by ECMAScript.
create or replace function public.psi_sales_normalize_client_name(input_name text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(
    trim(
      regexp_replace(
        input_name,
        '[' ||
          chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
          chr(160) || chr(5760) ||
          chr(8192) || '-' || chr(8202) ||
          chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) ||
        ']+',
        ' ',
        'g'
      )
    )
  )
$$;

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
  on public.psi_sales_clients (public.psi_sales_normalize_client_name(company_name));

alter table public.psi_sales_opportunities
  add column if not exists client_id uuid references public.psi_sales_clients(id) on delete restrict;

alter table public.psi_sales_opportunities
  add constraint psi_sales_opportunities_public_tender_client_check
  check (service_type_code is distinct from 'licitacion_publica' or client_id is null);

-- Fail closed if one canonical name mixes public tenders and private opportunities.
do $$
declare
  v_mixed_name text;
begin
  select public.psi_sales_normalize_client_name(company_name)
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

-- One client per canonical private name; newest opportunity data wins.
insert into public.psi_sales_clients (
  company_name, customer_segment, regional_nombre, sede, quote_city, economic_sector,
  decision_maker_name, decision_maker_email, decision_maker_phone, created_at, updated_at
)
select distinct on (public.psi_sales_normalize_client_name(o.company_name))
  o.company_name, o.customer_segment, o.regional_nombre, o.sede, o.quote_city, o.economic_sector,
  o.decision_maker_name, o.decision_maker_email, o.decision_maker_phone, o.created_at, o.updated_at
from public.psi_sales_opportunities o
where o.service_type_code is distinct from 'licitacion_publica'
order by public.psi_sales_normalize_client_name(o.company_name),
  coalesce(o.updated_at, o.created_at) desc,
  o.id desc;

-- Backfill private opportunities only.
update public.psi_sales_opportunities o
set client_id = c.id
from public.psi_sales_clients c
where o.service_type_code is distinct from 'licitacion_publica'
  and public.psi_sales_normalize_client_name(o.company_name)
    = public.psi_sales_normalize_client_name(c.company_name);

-- Client PII is server-side only. RLS has no end-user policies; service_role bypasses it.
alter table public.psi_sales_clients enable row level security;
revoke all on public.psi_sales_clients from public, anon, authenticated, service_role;
grant select, insert, update on public.psi_sales_clients to service_role;

revoke all on function public.psi_sales_normalize_client_name(text) from public, anon, authenticated, service_role;
grant execute on function public.psi_sales_normalize_client_name(text) to service_role;

commit;
