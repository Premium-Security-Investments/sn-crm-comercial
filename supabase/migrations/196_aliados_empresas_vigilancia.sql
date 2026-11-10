-- 196 — Aliados para uniones temporales (encargo AGT-002 del 2026-11-09; decisiones de Juan del 2026-11-09).
--
-- Juan: «empecemos a estructurar la estrategia de hacer uniones temporales», con una base viva de empresas de
-- vigilancia —aliados y competidores— en la plataforma, para todo proceso futuro que pida UT, y que cuando la
-- recomendación sea «buscar socio» Vig-IA proponga de una vez el aliado.
--
-- Tres tablas:
--   * `psi_vigilance_companies`: una fila por NIT del listado de la Superintendencia de Vigilancia. Lo del listado lo
--     reescribe la carga; lo nuestro (rol, contacto, notas) sólo lo cambia una persona y la carga nunca lo toca.
--   * `psi_vigilance_company_offices`: las oficinas del listado (ciudad, tipo, dirección, resolución). La carga las
--     reemplaza por NIT. Una oficina en el listado NO prueba la agencia para un pliego (memoria presencia-no-es-agencia).
--   * `psi_vigilance_participations`: en qué procesos vimos a cada empresa (ofertó, observó, adjudicatario, contratista
--     actual). Append-only.
-- Decidido: la plataforma pasa a ser la fuente y el Excel se deja de llenar.
begin;

create table if not exists public.psi_vigilance_companies (
  nit text primary key check (nit ~ '^[0-9]{6,12}$'),
  dv text check (dv is null or dv ~ '^[0-9]$'),
  name text not null check (nullif(btrim(name), '') is not null),
  acronyms text,
  representative text,
  phone text,
  email text,
  license_resolution text,
  license_date text,
  listing_source text,
  listing_loaded_at timestamptz,
  role text not null default 'sin_clasificar'
    check (role in ('sin_clasificar', 'aliado_potencial', 'aliado', 'competidor', 'descartado', 'nosotros')),
  contact text check (contact is null or char_length(contact) <= 1000),
  notes text check (notes is null or char_length(notes) <= 4000),
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.psi_vigilance_company_offices (
  id uuid primary key default gen_random_uuid(),
  nit text not null references public.psi_vigilance_companies(nit) on delete cascade,
  office_type text,
  address text,
  department text,
  city text not null,
  city_key text not null,
  phone text,
  email text,
  resolution text,
  resolution_date text,
  listing_page integer
);
create index if not exists psi_vigilance_company_offices_city on public.psi_vigilance_company_offices (city_key);
create index if not exists psi_vigilance_company_offices_nit on public.psi_vigilance_company_offices (nit);

create table if not exists public.psi_vigilance_participations (
  id uuid primary key default gen_random_uuid(),
  nit text references public.psi_vigilance_companies(nit) on delete set null,
  company_label text not null check (nullif(btrim(company_label), '') is not null),
  entity text,
  process_ref text not null check (nullif(btrim(process_ref), '') is not null),
  opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
  kind text not null check (kind in ('oferto', 'observo_proyecto', 'observo_definitivo', 'adjudicatario', 'contratista_actual', 'otro')),
  detail text check (detail is null or char_length(detail) <= 1000),
  source text check (source is null or char_length(source) <= 500),
  occurred_on date,
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists psi_vigilance_participations_nit on public.psi_vigilance_participations (nit);
create index if not exists psi_vigilance_participations_process on public.psi_vigilance_participations (process_ref);

create or replace function public.psi_vigilance_participations_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Las participaciones no se editan ni se borran.' using errcode = '42501';
end;
$$;
drop trigger if exists psi_vigilance_participations_append_only on public.psi_vigilance_participations;
create trigger psi_vigilance_participations_append_only before update or delete on public.psi_vigilance_participations
  for each row execute function public.psi_vigilance_participations_append_only();

do $$
declare v_table text;
begin
  foreach v_table in array array['psi_vigilance_companies', 'psi_vigilance_company_offices', 'psi_vigilance_participations'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select on table public.%I to service_role', v_table);
  end loop;
end;
$$;

create or replace function public.psi_assert_allies_actor(p_actor_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active
    where p.id = p_actor_id and p.active and coalesce(p.identity_type, 'human') = 'human' and p.role <> 'consulta'
  ) then
    raise exception 'Aliados requiere el permiso de Licitaciones.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.psi_assert_allies_actor(uuid) from public, anon, authenticated;
grant execute on function public.psi_assert_allies_actor(uuid) to service_role;

-- Carga o actualización del listado: `p_companies` = [{nit, dv, name, acronyms, representative, phone, email,
-- license_resolution, license_date, offices: [{office_type, address, department, city, city_key, phone, email,
-- resolution, resolution_date, listing_page}]}]. Reescribe lo del listado y las oficinas; nunca rol, contacto ni notas.
create or replace function public.psi_load_vigilance_listing(p_actor_id uuid, p_source text, p_companies jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company jsonb; v_office jsonb; v_companies integer := 0; v_offices integer := 0;
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if jsonb_typeof(p_companies) is distinct from 'array' then raise exception 'El listado debe ser una lista.' using errcode = '22023'; end if;
  for v_company in select * from jsonb_array_elements(p_companies) loop
    insert into public.psi_vigilance_companies (nit, dv, name, acronyms, representative, phone, email, license_resolution, license_date, listing_source, listing_loaded_at)
    values (v_company ->> 'nit', nullif(v_company ->> 'dv', ''), v_company ->> 'name', nullif(v_company ->> 'acronyms', ''),
      nullif(v_company ->> 'representative', ''), nullif(v_company ->> 'phone', ''), nullif(v_company ->> 'email', ''),
      nullif(v_company ->> 'license_resolution', ''), nullif(v_company ->> 'license_date', ''), p_source, now())
    on conflict (nit) do update set dv = excluded.dv, name = excluded.name, acronyms = excluded.acronyms,
      representative = excluded.representative, phone = excluded.phone, email = excluded.email,
      license_resolution = excluded.license_resolution, license_date = excluded.license_date,
      listing_source = excluded.listing_source, listing_loaded_at = excluded.listing_loaded_at;
    delete from public.psi_vigilance_company_offices where nit = v_company ->> 'nit';
    for v_office in select * from jsonb_array_elements(coalesce(v_company -> 'offices', '[]'::jsonb)) loop
      insert into public.psi_vigilance_company_offices (nit, office_type, address, department, city, city_key, phone, email, resolution, resolution_date, listing_page)
      values (v_company ->> 'nit', nullif(v_office ->> 'office_type', ''), nullif(v_office ->> 'address', ''), nullif(v_office ->> 'department', ''),
        v_office ->> 'city', v_office ->> 'city_key', nullif(v_office ->> 'phone', ''), nullif(v_office ->> 'email', ''),
        nullif(v_office ->> 'resolution', ''), nullif(v_office ->> 'resolution_date', ''), nullif(v_office ->> 'listing_page', '')::integer);
      v_offices := v_offices + 1;
    end loop;
    v_companies := v_companies + 1;
  end loop;
  return jsonb_build_object('companies', v_companies, 'offices', v_offices);
end;
$$;
revoke all on function public.psi_load_vigilance_listing(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.psi_load_vigilance_listing(uuid, text, jsonb) to service_role;

-- Lo nuestro de cada empresa: rol, contacto y notas.
create or replace function public.psi_update_vigilance_company(p_actor_id uuid, p_nit text, p_role text, p_contact text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_companies%rowtype;
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  update public.psi_vigilance_companies
    set role = coalesce(nullif(p_role, ''), role), contact = nullif(btrim(coalesce(p_contact, '')), ''),
        notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by = p_actor_id, updated_at = now()
    where nit = p_nit
    returning * into v_row;
  if not found then raise exception 'Esa empresa no está en la base.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_update_vigilance_company(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.psi_update_vigilance_company(uuid, text, text, text, text) to service_role;

-- Una participación (a mano o desde la carga inicial). El NIT es opcional: una UT sin integrantes conocidos va sin él.
create or replace function public.psi_add_vigilance_participation(p_actor_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_participations%rowtype; v_nit text := nullif(btrim(coalesce(p_payload ->> 'nit', '')), '');
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if v_nit is not null and not exists (select 1 from public.psi_vigilance_companies where nit = v_nit) then v_nit := null; end if;
  insert into public.psi_vigilance_participations (nit, company_label, entity, process_ref, opportunity_id, kind, detail, source, occurred_on, created_by)
  values (v_nit, btrim(p_payload ->> 'company_label'), nullif(btrim(coalesce(p_payload ->> 'entity', '')), ''), btrim(p_payload ->> 'process_ref'),
    nullif(p_payload ->> 'opportunity_id', '')::uuid, p_payload ->> 'kind', nullif(btrim(coalesce(p_payload ->> 'detail', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'source', '')), ''), nullif(p_payload ->> 'occurred_on', '')::date, p_actor_id)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_add_vigilance_participation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.psi_add_vigilance_participation(uuid, jsonb) to service_role;

commit;
