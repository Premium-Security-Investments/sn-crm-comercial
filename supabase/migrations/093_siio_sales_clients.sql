begin;

-- SIIO sales client master (migration 093): private-client source of truth.
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

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.psi_sales_opportunities'::regclass
      and conname = 'psi_sales_opportunities_public_tender_client_check'
  ) then
    alter table public.psi_sales_opportunities
      add constraint psi_sales_opportunities_public_tender_client_check
      check (service_type_code is distinct from 'licitacion_publica' or client_id is null);
  end if;
end
$$;

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
  o.id desc
on conflict (public.psi_sales_normalize_client_name(company_name)) do nothing;

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
-- P1-1 fix: an obsolete 6-arg signature (pre-dating p_authorized_sibling_ids) must not survive
-- alongside the 7-arg one below -- Postgres treats distinct parameter lists as distinct functions,
-- and a lingering 6-arg overload would make any 6-arg call ambiguous once the 7th parameter's
-- default makes the 7-arg function callable with 6 args too.
drop function if exists public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb);

create or replace function public.psi_persist_sales_opportunity(
  p_mode text,
  p_opportunity_id uuid,
  p_actor_profile_id uuid,
  p_requested_client_id uuid,
  p_opportunity jsonb,
  p_client jsonb,
  -- P1-1 fix: the exact, server-authorized sibling id snapshot the API computed (and re-verified
  -- the actor's authorization against) immediately before this call. NULL is accepted only for
  -- backward-compatible trusted/service_role 6-arg setup calls that bypass the sibling check
  -- entirely; every API code path must always pass its real (possibly empty) array.
  p_authorized_sibling_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
  v_opportunity_id uuid;
  v_existing_prelim_client_id uuid;
  v_existing public.psi_sales_opportunities;
  v_opp public.psi_sales_opportunities;
  v_company_name text;
  v_client public.psi_sales_clients;
  v_client_insert_conflicted boolean := false;
  v_current_sibling_ids uuid[];
  v_sorted_authorized uuid[];
  v_sorted_current uuid[];
  v_locked_client_ids uuid[];
begin
  if p_mode not in ('create', 'update') then
    raise exception 'psi_persist_sales_opportunity: modo no soportado "%"', p_mode;
  end if;

  if p_mode = 'update' then
    if p_opportunity_id is null then
      raise exception 'psi_persist_sales_opportunity: falta opportunity_id para actualizar';
    end if;

    -- Deadlock-safe order: resolve enough state (the target's current client_id) with a plain,
    -- unlocked read first, so the resolved client row below always gets locked before any
    -- opportunity row lock -- every protected caller then acquires locks in the same
    -- client-then-opportunity order and cannot deadlock against another such caller.
    select client_id into v_existing_prelim_client_id
    from public.psi_sales_opportunities
    where id = p_opportunity_id;

    if not found then
      raise exception 'psi_persist_sales_opportunity: la oportunidad % no existe', p_opportunity_id;
    end if;

    v_client_id := v_existing_prelim_client_id;
  end if;

  -- Resolve the client: an explicit requested id wins; otherwise find-or-insert atomically by
  -- canonical normalized company_name (the unique index on psi_sales_clients makes the
  -- insert/select fallback below race-safe without an explicit advisory lock).
  if p_opportunity->>'service_type_code' = 'licitacion_publica' then
    v_client_id := null;
  elsif p_requested_client_id is not null then
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
      -- Lost the canonical-name unique-index race: this caller's own insert conflicted and the
      -- id below is an already-committed different client's row, never one this caller controls.
      v_client_insert_conflicted := true;

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

  -- P1-1 fix (deadlock-safe order): lock the resolved client row before any opportunity row lock
  -- below -- every create/relink/sync path that resolves a client id (explicit request, name
  -- match, or newly-inserted) converges here and takes the same lock, so concurrent callers
  -- targeting the same client, or racing over the same target/sibling rows, always acquire locks
  -- in the same client-then-opportunity order. This also folds in the p_requested_client_id
  -- existence check that used to run separately.
  --
  -- Cross-relink ABBA fix: an update carrying a server-authorized sibling snapshot may be
  -- relinking the target from its preliminary/source client (v_existing_prelim_client_id) onto a
  -- different resolved/destination client (v_client_id). Locking only the destination client is
  -- not enough -- transaction X relinking C1->C2 concurrently with transaction Y relinking C2->C1
  -- would each lock only their own destination client/siblings and then deadlock waiting on each
  -- other's target opportunity row. Locking both nonnull client ids together, sorted by id, in one
  -- statement before any opportunity row lock forces both transactions to contend for the same
  -- first client lock (min(id)) instead. A plain sync (source == destination, or either side null)
  -- collapses naturally since `id in (...)` matches the same row once.
  if p_mode = 'update' and p_authorized_sibling_ids is not null then
    select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_locked_client_ids
    from (
      select id
      from public.psi_sales_clients
      where id in (v_client_id, v_existing_prelim_client_id)
      order by id
      for update
    ) locked_clients;

    if v_client_id is not null then
      select * into v_client
      from public.psi_sales_clients
      where id = v_client_id;

      if not found then
        raise exception 'psi_persist_sales_opportunity: el cliente solicitado % no existe', v_client_id;
      end if;
    end if;
  elsif v_client_id is not null then
    select * into v_client
    from public.psi_sales_clients
    where id = v_client_id
    for update;

    if not found then
      raise exception 'psi_persist_sales_opportunity: el cliente solicitado % no existe', v_client_id;
    end if;
  end if;

  -- P1-1 fix: only a caller that supplied a real (possibly empty) server-authorized sibling
  -- snapshot pays for locking every opportunity currently on this client, in deterministic (id)
  -- order so two callers racing over an overlapping sibling set always lock per-row in the same
  -- order and cannot deadlock. This also locks the update-mode target row together with its
  -- siblings whenever the target is already on this same client (a plain sync, not a relink). A
  -- NULL p_authorized_sibling_ids (backward-compatible trusted/service_role setup calls) skips
  -- this entirely and locks only its own target row below instead.
  if p_authorized_sibling_ids is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_current_sibling_ids
    from (
      select id
      from public.psi_sales_opportunities
      where client_id = v_client_id
      order by id
      for update
    ) locked_siblings;
  end if;

  if p_mode = 'update' then
    -- Relink case: the target is not part of the destination client's rows locked just above (its
    -- client_id in storage is still the prior one), so lock it next, after the destination
    -- siblings -- "lock destination siblings then target" -- and re-read it under lock to fail
    -- closed if its client linkage changed concurrently since the preliminary read above.
    select * into v_existing
    from public.psi_sales_opportunities
    where id = p_opportunity_id
    for update;

    if not found then
      raise exception 'psi_persist_sales_opportunity: la oportunidad % no existe', p_opportunity_id;
    end if;

    if v_existing.client_id is distinct from v_existing_prelim_client_id then
      raise exception 'psi_persist_sales_opportunity: la oportunidad % cambió de cliente concurrentemente, reintente', p_opportunity_id;
    end if;
  end if;

  -- P1-1 fix: fail closed if the locked current-sibling snapshot does not exactly match the
  -- caller's server-authorized sibling id set -- byte-for-byte, duplicates included, and excluding
  -- the update-mode target itself exactly as the API's own authorization snapshot does -- before
  -- any master-field or opportunity mutation happens below.
  if p_authorized_sibling_ids is not null then
    select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_sorted_authorized from unnest(p_authorized_sibling_ids) as x;
    select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_sorted_current
    from unnest(v_current_sibling_ids) as x
    where p_opportunity_id is null or x <> p_opportunity_id;

    if v_sorted_authorized is distinct from v_sorted_current then
      -- Narrow legit-loser carve-out: a brand-new-client create that lost the canonical-name
      -- unique-index race above (its own INSERT ... ON CONFLICT DO NOTHING resolved to a
      -- different, already-committed client) legitimately authorized itself against an empty
      -- sibling set -- it could not have known about that winning client's siblings in advance.
      -- Every other path (explicit requested client, relink, sync, update, or any nonempty/
      -- tampered authorized array) remains exact fail-closed.
      if not (
        p_mode = 'create'
        and p_requested_client_id is null
        and p_client is not null
        and v_client_insert_conflicted
        and coalesce(array_length(p_authorized_sibling_ids, 1), 0) = 0
      ) then
        raise exception 'psi_persist_sales_opportunity: el conjunto de oportunidades hermanas autorizado no coincide con el vigente del cliente % (sibling authorization mismatch)', v_client_id;
      end if;
    end if;
  end if;

  -- Update mode also applies any supplied client fields to the resolved client master.
  if p_mode = 'update' and p_client is not null and v_client_id is not null then
    update public.psi_sales_clients set
      company_name = coalesce(nullif(p_client->>'company_name', ''), company_name),
      customer_segment = p_client->>'customer_segment',
      regional_nombre = p_client->>'regional_nombre',
      sede = p_client->>'sede',
      quote_city = p_client->>'quote_city',
      economic_sector = p_client->>'economic_sector',
      decision_maker_name = p_client->>'decision_maker_name',
      decision_maker_email = p_client->>'decision_maker_email',
      decision_maker_phone = p_client->>'decision_maker_phone',
      updated_at = now()
    where id = v_client_id
    returning * into v_client;

    update public.psi_sales_opportunities o set
      company_name = c.company_name,
      customer_segment = c.customer_segment,
      regional_nombre = c.regional_nombre,
      sede = c.sede,
      quote_city = c.quote_city,
      economic_sector = c.economic_sector,
      decision_maker_name = c.decision_maker_name,
      decision_maker_email = c.decision_maker_email,
      decision_maker_phone = c.decision_maker_phone,
      updated_at = now()
    from public.psi_sales_clients c
    where c.id = v_client_id
      and o.client_id = v_client_id;
  end if;

  if p_mode = 'create' then
    v_opp := jsonb_populate_record(null::public.psi_sales_opportunities, p_opportunity);
    v_opp.id := coalesce(v_opp.id, gen_random_uuid());
    v_opp.client_id := v_client_id;
    v_opp.owner_id := coalesce(v_opp.owner_id, p_actor_profile_id);
    v_opp.created_at := coalesce(v_opp.created_at, now());
    v_opp.updated_at := now();

    -- P1-3/P2-1: for a private opportunity, the master-owned fields on the newly-created row must
    -- come from the client master that v_client_id actually resolved to (already locked/read above
    -- by the P1-1 client lock), never from this caller's own p_opportunity/p_client -- otherwise a
    -- create that loses the client-name race (ON CONFLICT DO NOTHING above) would permanently
    -- disagree with the client it references.
    if v_client_id is not null then
      v_opp.company_name := v_client.company_name;
      v_opp.customer_segment := v_client.customer_segment;
      v_opp.regional_nombre := v_client.regional_nombre;
      v_opp.sede := v_client.sede;
      v_opp.quote_city := v_client.quote_city;
      v_opp.economic_sector := v_client.economic_sector;
      v_opp.decision_maker_name := v_client.decision_maker_name;
      v_opp.decision_maker_email := v_client.decision_maker_email;
      v_opp.decision_maker_phone := v_client.decision_maker_phone;
    end if;

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

    -- P1-3 relink fix: mirror the create-path override -- after jsonb_populate_record merges
    -- p_opportunity onto v_existing, the master-owned fields must reflect the client master
    -- v_client_id actually resolved to (already locked/refreshed above), not whatever the caller's
    -- own payload carried, so a relink (or an update sharing this client) never disagrees with it.
    if v_client_id is not null then
      v_opp.company_name := v_client.company_name;
      v_opp.customer_segment := v_client.customer_segment;
      v_opp.regional_nombre := v_client.regional_nombre;
      v_opp.sede := v_client.sede;
      v_opp.quote_city := v_client.quote_city;
      v_opp.economic_sector := v_client.economic_sector;
      v_opp.decision_maker_name := v_client.decision_maker_name;
      v_opp.decision_maker_email := v_client.decision_maker_email;
      v_opp.decision_maker_phone := v_client.decision_maker_phone;
    end if;

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

revoke all on function public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb,uuid[])
  from public, anon, authenticated;
grant execute on function public.psi_persist_sales_opportunity(text,uuid,uuid,uuid,jsonb,jsonb,uuid[])
  to service_role;

commit;
