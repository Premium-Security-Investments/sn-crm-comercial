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

-- Blocker D fix (PR #229): single atomic RPC so the API replaces its client-master + opportunity
-- write sequence (resolveClientForNewOpportunity / updateClientMasterAndSync /
-- commitClientForOpportunityUpdate) with exactly one transactional call. A failure anywhere in
-- this function aborts the whole top-level statement, so a client master inserted earlier in the
-- same call is never left orphaned by a later failure.
create or replace function public.psi_persist_sales_opportunity(
  p_mode text,
  p_opportunity_id uuid,
  p_actor_profile_id uuid,
  p_requested_client_id uuid,
  p_opportunity jsonb,
  p_client jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
  v_opportunity_id uuid;
  v_existing public.psi_sales_opportunities;
  v_opp public.psi_sales_opportunities;
  v_company_name text;
begin
  if p_mode not in ('create', 'update') then
    raise exception 'psi_persist_sales_opportunity: modo no soportado "%"', p_mode;
  end if;

  if p_mode = 'update' then
    if p_opportunity_id is null then
      raise exception 'psi_persist_sales_opportunity: falta opportunity_id para actualizar';
    end if;

    select * into v_existing
    from public.psi_sales_opportunities
    where id = p_opportunity_id
    for update;

    if not found then
      raise exception 'psi_persist_sales_opportunity: la oportunidad % no existe', p_opportunity_id;
    end if;

    v_client_id := v_existing.client_id;
  end if;

  -- Resolve the client: an explicit requested id wins; otherwise find-or-insert atomically by
  -- canonical normalized company_name (the unique index on psi_sales_clients makes the
  -- insert/select fallback below race-safe without an explicit advisory lock).
  if p_requested_client_id is not null then
    perform 1 from public.psi_sales_clients where id = p_requested_client_id;
    if not found then
      raise exception 'psi_persist_sales_opportunity: el cliente solicitado % no existe', p_requested_client_id;
    end if;
    v_client_id := p_requested_client_id;
  elsif p_client is not null and length(trim(coalesce(p_client->>'company_name', ''))) > 0 then
    v_company_name := p_client->>'company_name';

    insert into public.psi_sales_clients (
      company_name, customer_segment, regional_nombre, sede, quote_city, economic_sector,
      decision_maker_name, decision_maker_email, decision_maker_phone
    )
    values (
      v_company_name, p_client->>'customer_segment', p_client->>'regional_nombre',
      p_client->>'sede', p_client->>'quote_city', p_client->>'economic_sector',
      p_client->>'decision_maker_name', p_client->>'decision_maker_email', p_client->>'decision_maker_phone'
    )
    on conflict (public.psi_sales_normalize_client_name(company_name)) do nothing
    returning id into v_client_id;

    if v_client_id is null then
      select id into v_client_id
      from public.psi_sales_clients
      where public.psi_sales_normalize_client_name(company_name)
        = public.psi_sales_normalize_client_name(v_company_name)
      limit 1;
    end if;

    if v_client_id is null then
      raise exception 'psi_persist_sales_opportunity: no se pudo resolver el cliente para "%"', v_company_name;
    end if;
  end if;

  -- Update mode also applies any supplied client fields to the resolved client master.
  if p_mode = 'update' and p_client is not null and v_client_id is not null then
    update public.psi_sales_clients set
      company_name = coalesce(p_client->>'company_name', company_name),
      customer_segment = coalesce(p_client->>'customer_segment', customer_segment),
      regional_nombre = coalesce(p_client->>'regional_nombre', regional_nombre),
      sede = coalesce(p_client->>'sede', sede),
      quote_city = coalesce(p_client->>'quote_city', quote_city),
      economic_sector = coalesce(p_client->>'economic_sector', economic_sector),
      decision_maker_name = coalesce(p_client->>'decision_maker_name', decision_maker_name),
      decision_maker_email = coalesce(p_client->>'decision_maker_email', decision_maker_email),
      decision_maker_phone = coalesce(p_client->>'decision_maker_phone', decision_maker_phone),
      updated_at = now()
    where id = v_client_id;
  end if;

  if p_mode = 'create' then
    v_opp := jsonb_populate_record(null::public.psi_sales_opportunities, p_opportunity);
    v_opp.id := coalesce(v_opp.id, gen_random_uuid());
    v_opp.client_id := v_client_id;
    v_opp.owner_id := coalesce(v_opp.owner_id, p_actor_profile_id);
    v_opp.created_at := coalesce(v_opp.created_at, now());
    v_opp.updated_at := now();

    insert into public.psi_sales_opportunities (
      id, owner_id, company_name, economic_sector, decision_maker_name, decision_maker_email,
      decision_maker_phone, quote_city, quote_date, offer_value, service_type_code, stage_code,
      loss_reason_code, loss_notes, next_action_at, expected_close_date, commission_rate,
      regional_nombre, sede, tipo_producto_original, observaciones, customer_segment,
      external_source, client_id, created_at, updated_at
    ) values (
      v_opp.id, v_opp.owner_id, v_opp.company_name, v_opp.economic_sector, v_opp.decision_maker_name,
      v_opp.decision_maker_email, v_opp.decision_maker_phone, v_opp.quote_city, v_opp.quote_date,
      v_opp.offer_value, v_opp.service_type_code, v_opp.stage_code, v_opp.loss_reason_code,
      v_opp.loss_notes, v_opp.next_action_at, v_opp.expected_close_date, v_opp.commission_rate,
      v_opp.regional_nombre, v_opp.sede, v_opp.tipo_producto_original, v_opp.observaciones,
      v_opp.customer_segment, v_opp.external_source, v_opp.client_id, v_opp.created_at, v_opp.updated_at
    )
    returning id into v_opportunity_id;
  else
    v_opp := jsonb_populate_record(v_existing, p_opportunity);
    v_opp.id := p_opportunity_id;
    v_opp.client_id := v_client_id;
    v_opp.created_at := v_existing.created_at;
    v_opp.updated_at := now();

    update public.psi_sales_opportunities
    set (
      owner_id, company_name, economic_sector, decision_maker_name, decision_maker_email,
      decision_maker_phone, quote_city, quote_date, offer_value, service_type_code, stage_code,
      loss_reason_code, loss_notes, next_action_at, expected_close_date, commission_rate,
      regional_nombre, sede, tipo_producto_original, observaciones, customer_segment,
      external_source, client_id, updated_at
    ) = (
      v_opp.owner_id, v_opp.company_name, v_opp.economic_sector, v_opp.decision_maker_name,
      v_opp.decision_maker_email, v_opp.decision_maker_phone, v_opp.quote_city, v_opp.quote_date,
      v_opp.offer_value, v_opp.service_type_code, v_opp.stage_code, v_opp.loss_reason_code,
      v_opp.loss_notes, v_opp.next_action_at, v_opp.expected_close_date, v_opp.commission_rate,
      v_opp.regional_nombre, v_opp.sede, v_opp.tipo_producto_original, v_opp.observaciones,
      v_opp.customer_segment, v_opp.external_source, v_opp.client_id, v_opp.updated_at
    )
    where id = p_opportunity_id;

    v_opportunity_id := p_opportunity_id;
  end if;

  return jsonb_build_object('opportunity_id', v_opportunity_id, 'client_id', v_client_id);
end;
$$;

revoke all on function public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb)
  to service_role;

commit;
