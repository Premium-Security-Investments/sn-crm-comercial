-- AGT-001 / Gerencia: cargue versionado de libros contables.
-- Source-only migration. Applying it to any remote environment requires a separate gate.

create table if not exists public.siio_financial_imports (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.siio_sources(id) on delete restrict,
  file_name text not null,
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  storage_path text not null unique,
  version_label text,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  cutoff_date date not null,
  import_type text not null check (import_type in ('cierre_mensual','parcial_diario','reproceso')),
  status text not null check (status in ('recibido','con_errores','validado','publicado','reemplazado')),
  parser_version text not null,
  structure_signature text not null check (structure_signature ~ '^[0-9a-f]{64}$'),
  structure_summary jsonb not null default '{}'::jsonb,
  structure_diff jsonb not null default '{}'::jsonb,
  import_summary jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.psi_sales_profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  validated_by uuid references public.psi_sales_profiles(id) on delete set null,
  validated_at timestamptz,
  published_by uuid references public.psi_sales_profiles(id) on delete set null,
  published_at timestamptz,
  notes text
);

create table if not exists public.siio_financial_balance_lines (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.siio_financial_imports(id) on delete restrict,
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  account text not null check (account ~ '^\d{1,8}$'),
  account_name text not null default '',
  level integer not null check (level between 1 and 8),
  account_class integer not null check (account_class between 0 and 9),
  previous_balance numeric(20,4),
  debits numeric(20,4),
  credits numeric(20,4),
  final_balance numeric(20,4),
  has_manual_adjustment boolean not null default false,
  original_formula text,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  unique (import_id, source_sheet, source_row, account)
);

create table if not exists public.siio_financial_validations (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.siio_financial_imports(id) on delete restrict,
  rule text not null,
  severity text not null check (severity in ('bloqueante','advertencia','info')),
  ok boolean not null,
  expected text,
  obtained text,
  difference numeric,
  detail text not null default '',
  created_at timestamptz not null default now()
);

alter table public.siio_financial_metrics
  add column if not exists import_id uuid references public.siio_financial_imports(id) on delete restrict,
  add column if not exists base_value text not null default 'acumulado' check (base_value in ('acumulado','mes')),
  add column if not exists figure_type text not null default 'reportado' check (figure_type in ('contable','provision','ajuste_gerencial','estimado','reportado','proyeccion','meta')),
  add column if not exists source_sheet text,
  add column if not exists source_cell text;

drop index if exists public.uq_siio_financial_metric_period_concept_source;
create unique index if not exists uq_siio_financial_metric_import_concept
  on public.siio_financial_metrics(import_id, concept)
  where import_id is not null;
create unique index if not exists uq_siio_financial_metric_legacy_period_concept_source
  on public.siio_financial_metrics(period_month, concept, source_id)
  where import_id is null;
create index if not exists idx_siio_financial_imports_period_status
  on public.siio_financial_imports(period_month, status, cutoff_date desc, uploaded_at desc);
create unique index if not exists uq_siio_financial_import_published_period
  on public.siio_financial_imports(period_month)
  where status = 'publicado';
create index if not exists idx_siio_financial_balance_import
  on public.siio_financial_balance_lines(import_id, year, month, account);
create index if not exists idx_siio_financial_validation_import
  on public.siio_financial_validations(import_id, severity, ok);

alter table public.siio_financial_imports enable row level security;
alter table public.siio_financial_balance_lines enable row level security;
alter table public.siio_financial_validations enable row level security;

revoke all on table public.siio_financial_imports from public, anon, authenticated, service_role;
revoke all on table public.siio_financial_balance_lines from public, anon, authenticated, service_role;
revoke all on table public.siio_financial_validations from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_financial_imports to service_role;
grant select, insert on table public.siio_financial_balance_lines to service_role;
grant select, insert on table public.siio_financial_validations to service_role;
grant usage, select on sequence public.siio_financial_balance_lines_id_seq to service_role;
grant usage, select on sequence public.siio_financial_validations_id_seq to service_role;

do $storage_bucket$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'siio-financial-imports',
        'siio-financial-imports',
        false,
        10485760,
        array['application/vnd.ms-excel.sheet.macroenabled.12']::text[]
      )
    $sql$;
  end if;
end
$storage_bucket$;

create or replace function public.siio_import_financial_workbook(p_payload jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.siio_financial_imports%rowtype;
  v_import public.siio_financial_imports%rowtype;
  v_source_id text;
begin
  if p_actor is null or not exists (
    select 1 from public.psi_sales_profiles where id = p_actor and active is true and role in ('admin','gerencia')
  ) then
    raise exception 'actor_not_authorized' using errcode = '42501';
  end if;

  select * into v_existing
  from public.siio_financial_imports
  where file_sha256 = p_payload->>'file_sha256';
  if found then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'duplicate', true);
  end if;

  v_source_id := 'FIN-' || upper(substr(p_payload->>'file_sha256', 1, 16));
  insert into public.siio_sources (
    id, name, source_type, related_fronts, owner, responsible_area, trust_level, status,
    permissions, allowed_agent_use, restrictions, update_frequency, last_reviewed_at
  ) values (
    v_source_id,
    p_payload->>'file_name',
    'Archivo Excel financiero / PYG versionado',
    array['F2','F4','F5'],
    'Financiera / Gerencia',
    'Financiera / Gerencia',
    'oficial_requiere_validacion',
    'activa',
    'Gerencia; Financiera; agentes autorizados',
    'Extraer indicadores agregados; comparar periodos; alimentar la Torre de Control',
    'Información financiera agregada. Cada corte es inmutable y requiere aprobación humana para publicación mensual.',
    case when p_payload->>'import_type' = 'parcial_diario' then 'diaria' else 'mensual' end,
    current_date
  )
  on conflict (id) do nothing;

  insert into public.siio_financial_imports (
    source_id, file_name, file_sha256, file_size_bytes, storage_path, version_label,
    period_month, cutoff_date, import_type, status, parser_version, structure_signature,
    structure_summary, structure_diff, import_summary, uploaded_by,
    validated_at
  ) values (
    v_source_id,
    p_payload->>'file_name',
    p_payload->>'file_sha256',
    (p_payload->>'file_size_bytes')::bigint,
    p_payload->>'storage_path',
    nullif(p_payload->>'version_label', ''),
    (p_payload->>'period_month')::date,
    (p_payload->>'cutoff_date')::date,
    p_payload->>'import_type',
    p_payload->>'status',
    p_payload->>'parser_version',
    p_payload->>'structure_signature',
    coalesce(p_payload->'structure', '{}'::jsonb),
    coalesce(p_payload->'structure_diff', '{}'::jsonb),
    coalesce(p_payload->'summary', '{}'::jsonb),
    p_actor,
    case when p_payload->>'status' = 'validado' then now() else null end
  ) returning * into v_import;

  insert into public.siio_financial_balance_lines (
    import_id, year, month, account, account_name, level, account_class,
    previous_balance, debits, credits, final_balance, has_manual_adjustment,
    original_formula, source_sheet, source_row
  )
  select
    v_import.id, x.year, x.month, x.account, x.account_name, x.level, x.account_class,
    x.previous_balance, x.debits, x.credits, x.final_balance, x.has_manual_adjustment,
    x.original_formula, x.source_sheet, x.source_row
  from jsonb_to_recordset(coalesce(p_payload->'balance_lines', '[]'::jsonb)) as x(
    year integer, month integer, account text, account_name text, level integer, account_class integer,
    previous_balance numeric, debits numeric, credits numeric, final_balance numeric,
    has_manual_adjustment boolean, original_formula text, source_sheet text, source_row integer
  );

  insert into public.siio_financial_metrics (
    import_id, period_month, category, concept, value_current, value_comparison,
    variation_abs, variation_pct, source_id, validated_by, notes,
    base_value, figure_type, source_sheet, source_cell
  )
  select
    v_import.id, v_import.period_month, x.category, x.concept, x.value_current, x.value_comparison,
    x.variation_abs, x.variation_pct, v_source_id, null,
    'Extraído del libro versionado; publicación mensual pendiente de aprobación humana.',
    'acumulado', 'reportado', x.source_sheet, x.source_cell
  from jsonb_to_recordset(coalesce(p_payload->'metrics', '[]'::jsonb)) as x(
    category text, concept text, value_current numeric, value_comparison numeric,
    variation_abs numeric, variation_pct numeric, source_sheet text, source_cell text
  );

  insert into public.siio_financial_validations (
    import_id, rule, severity, ok, expected, obtained, difference, detail
  )
  select v_import.id, x.rule, x.severity, x.ok, x.expected, x.obtained, x.difference, x.detail
  from jsonb_to_recordset(coalesce(p_payload->'validations', '[]'::jsonb)) as x(
    rule text, severity text, ok boolean, expected text, obtained text, difference numeric, detail text
  );

  return jsonb_build_object('id', v_import.id, 'status', v_import.status, 'duplicate', false);
end;
$$;

create or replace function public.siio_publish_financial_import(p_import_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_import public.siio_financial_imports%rowtype;
begin
  if p_actor is null or not exists (
    select 1 from public.psi_sales_profiles where id = p_actor and active is true and role in ('admin','gerencia')
  ) then
    raise exception 'actor_not_authorized' using errcode = '42501';
  end if;
  select * into v_import from public.siio_financial_imports where id = p_import_id for update;
  if not found then raise exception 'financial_import_not_found' using errcode = 'P0002'; end if;
  if v_import.status <> 'validado' or v_import.import_type = 'parcial_diario' then
    raise exception 'financial_import_not_publishable' using errcode = '55000';
  end if;
  if exists (select 1 from public.siio_financial_validations where import_id = p_import_id and severity = 'bloqueante' and ok is false) then
    raise exception 'financial_import_has_blockers' using errcode = '23514';
  end if;

  update public.siio_financial_imports
  set status = 'reemplazado'
  where period_month = v_import.period_month and status = 'publicado' and id <> p_import_id;

  update public.siio_financial_imports
  set status = 'publicado', published_by = p_actor, published_at = now(),
      validated_by = coalesce(validated_by, p_actor), validated_at = coalesce(validated_at, now())
  where id = p_import_id
  returning * into v_import;

  update public.siio_sources set trust_level = 'oficial', last_reviewed_at = current_date, updated_at = now()
  where id = v_import.source_id;
  return jsonb_build_object('id', v_import.id, 'status', v_import.status, 'period_month', v_import.period_month);
end;
$$;

revoke all on function public.siio_import_financial_workbook(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.siio_publish_financial_import(uuid, uuid) from public, anon, authenticated;
grant execute on function public.siio_import_financial_workbook(jsonb, uuid) to service_role;
grant execute on function public.siio_publish_financial_import(uuid, uuid) to service_role;

create or replace view public.siio_financial_metrics_current
with (security_invoker = true)
as
with eligible as (
  select i.*,
    row_number() over (
      partition by i.period_month
      order by
        case when i.status = 'publicado' then 0 else 1 end,
        i.cutoff_date desc,
        i.uploaded_at desc
    ) as position
  from public.siio_financial_imports i
  where i.status = 'publicado'
     or (i.status = 'validado' and i.import_type = 'parcial_diario')
), active as (
  select * from eligible where position = 1
), versioned as (
  select m.* from public.siio_financial_metrics m join active a on a.id = m.import_id
), legacy as (
  select m.*
  from public.siio_financial_metrics m
  where m.import_id is null
    and not exists (select 1 from active a where a.period_month = m.period_month)
)
select * from versioned
union all
select * from legacy;

revoke all on table public.siio_financial_metrics_current from public, anon, authenticated, service_role;
grant select on table public.siio_financial_metrics_current to service_role;
