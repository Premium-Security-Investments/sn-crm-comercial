-- 233 — Aliados: la ficha del RUP de cada empresa y lo que deciden los pliegos (Juan, 2026-11-21: «defina qué información
-- va a ser valiosa y a los aliados importantes les empezamos a cargar este documento para que se actualice la
-- información»; propuesta aprobada el mismo día, handoff 2026-11-21-AGT-002-aliados-ficha-rup-propuesta.md).
--
-- 1. `psi_vigilance_company_rup`: una fila por documento cargado (consulta de ruppro o certificado de la Cámara), con su
--    fecha de corte. Lo que el documento no trae queda null («sin dato»), nunca cero. Se guarda la historia; la pantalla
--    usa la más reciente por fecha de corte. El mismo documento (sha256) no se guarda dos veces.
-- 2. En la empresa: frecuencia MinTIC (ciudades y fuente) y SG-SST (% y fecha), que se confirman en la llamada o con
--    documentos. Funciones nuevas con nombre propio (memoria firma-nueva-nace-sin-permisos).
begin;

create table if not exists public.psi_vigilance_company_rup (
  id uuid primary key default gen_random_uuid(),
  nit text not null references public.psi_vigilance_companies(nit) on delete cascade,
  source_kind text not null check (source_kind in ('consulta_ruppro', 'certificado_camara')),
  cut_date date,
  reported_name text check (reported_name is null or char_length(reported_name) <= 300),
  total_assets numeric, total_liabilities numeric, current_assets numeric, current_liabilities numeric,
  equity numeric, operating_income numeric, interest_expense numeric,
  roe numeric, roa numeric, liquidity numeric, working_capital numeric, debt_ratio numeric, interest_coverage numeric,
  has_fines boolean, has_sanctions boolean, has_disqualification boolean,
  contracts_total integer, contracts_own integer, smmlv_total numeric, smmlv_own numeric,
  largest_own_smmlv numeric, largest_own_client text check (largest_own_client is null or char_length(largest_own_client) <= 300),
  has_guard_code boolean, has_systems_code boolean,
  contracts jsonb not null default '[]'::jsonb check (jsonb_typeof(contracts) = 'array'),
  document_name text check (document_name is null or char_length(document_name) <= 300),
  document_sha256 text check (document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text check (storage_path is null or char_length(storage_path) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create unique index if not exists psi_vigilance_company_rup_document_uniq on public.psi_vigilance_company_rup (nit, document_sha256) where document_sha256 is not null;
create index if not exists psi_vigilance_company_rup_nit_cut on public.psi_vigilance_company_rup (nit, cut_date desc, created_at desc);

alter table public.psi_vigilance_company_rup enable row level security;
revoke all on table public.psi_vigilance_company_rup from public, anon, authenticated, service_role;
grant select on table public.psi_vigilance_company_rup to service_role;

alter table public.psi_vigilance_companies
  add column if not exists radio_cities text check (radio_cities is null or char_length(radio_cities) <= 500),
  add column if not exists radio_source text check (radio_source is null or char_length(radio_source) <= 500),
  add column if not exists sgsst_pct numeric check (sgsst_pct is null or (sgsst_pct >= 0 and sgsst_pct <= 100)),
  add column if not exists sgsst_date date;

-- Guarda un documento del RUP ya leído. `p_payload` = salida de rupPayload() (aliados-rup.js).
create or replace function public.psi_save_vigilance_rup(p_actor_id uuid, p_nit text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_company_rup%rowtype; v_num text[] := array[
  'total_assets','total_liabilities','current_assets','current_liabilities','equity','operating_income','interest_expense',
  'roe','roa','liquidity','working_capital','debt_ratio','interest_coverage','smmlv_total','smmlv_own','largest_own_smmlv'];
  v_key text;
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'El documento no es válido.' using errcode = '22023'; end if;
  if not exists (select 1 from public.psi_vigilance_companies where nit = p_nit) then
    raise exception 'Esa empresa no está en la base.' using errcode = 'P0002';
  end if;
  foreach v_key in array v_num loop
    if p_payload ? v_key and jsonb_typeof(p_payload -> v_key) not in ('number', 'null') then
      raise exception 'El dato % no es un número.', v_key using errcode = '22023';
    end if;
  end loop;
  if nullif(p_payload ->> 'document_sha256', '') is not null then
    select * into v_row from public.psi_vigilance_company_rup where nit = p_nit and document_sha256 = p_payload ->> 'document_sha256';
    if found then return to_jsonb(v_row) || jsonb_build_object('already_loaded', true); end if;
  end if;
  insert into public.psi_vigilance_company_rup (
    nit, source_kind, cut_date, reported_name, total_assets, total_liabilities, current_assets, current_liabilities, equity,
    operating_income, interest_expense, roe, roa, liquidity, working_capital, debt_ratio, interest_coverage,
    has_fines, has_sanctions, has_disqualification, contracts_total, contracts_own, smmlv_total, smmlv_own,
    largest_own_smmlv, largest_own_client, has_guard_code, has_systems_code, contracts, document_name, document_sha256,
    storage_path, created_by)
  values (
    p_nit, p_payload ->> 'source_kind', nullif(p_payload ->> 'cut_date', '')::date, left(nullif(p_payload ->> 'reported_name', ''), 300),
    (p_payload ->> 'total_assets')::numeric, (p_payload ->> 'total_liabilities')::numeric, (p_payload ->> 'current_assets')::numeric,
    (p_payload ->> 'current_liabilities')::numeric, (p_payload ->> 'equity')::numeric, (p_payload ->> 'operating_income')::numeric,
    (p_payload ->> 'interest_expense')::numeric, (p_payload ->> 'roe')::numeric, (p_payload ->> 'roa')::numeric,
    (p_payload ->> 'liquidity')::numeric, (p_payload ->> 'working_capital')::numeric, (p_payload ->> 'debt_ratio')::numeric,
    (p_payload ->> 'interest_coverage')::numeric, (p_payload ->> 'has_fines')::boolean, (p_payload ->> 'has_sanctions')::boolean,
    (p_payload ->> 'has_disqualification')::boolean, (p_payload ->> 'contracts_total')::integer, (p_payload ->> 'contracts_own')::integer,
    (p_payload ->> 'smmlv_total')::numeric, (p_payload ->> 'smmlv_own')::numeric, (p_payload ->> 'largest_own_smmlv')::numeric,
    left(nullif(p_payload ->> 'largest_own_client', ''), 300), (p_payload ->> 'has_guard_code')::boolean,
    (p_payload ->> 'has_systems_code')::boolean, coalesce(p_payload -> 'contracts', '[]'::jsonb),
    left(nullif(p_payload ->> 'document_name', ''), 300), nullif(p_payload ->> 'document_sha256', ''),
    left(nullif(p_payload ->> 'storage_path', ''), 500), p_actor_id)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_save_vigilance_rup(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.psi_save_vigilance_rup(uuid, text, jsonb) to service_role;

-- Frecuencia MinTIC y SG-SST de una empresa. `p_payload` = {radio_cities, radio_source, sgsst_pct, sgsst_date}.
create or replace function public.psi_save_vigilance_capabilities(p_actor_id uuid, p_nit text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_companies%rowtype;
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Los datos no son válidos.' using errcode = '22023'; end if;
  update public.psi_vigilance_companies
    set radio_cities = nullif(btrim(coalesce(p_payload ->> 'radio_cities', '')), ''),
        radio_source = nullif(btrim(coalesce(p_payload ->> 'radio_source', '')), ''),
        sgsst_pct = nullif(p_payload ->> 'sgsst_pct', '')::numeric,
        sgsst_date = nullif(p_payload ->> 'sgsst_date', '')::date,
        updated_by = p_actor_id, updated_at = now()
    where nit = p_nit
    returning * into v_row;
  if not found then raise exception 'Esa empresa no está en la base.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_save_vigilance_capabilities(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.psi_save_vigilance_capabilities(uuid, text, jsonb) to service_role;

commit;
