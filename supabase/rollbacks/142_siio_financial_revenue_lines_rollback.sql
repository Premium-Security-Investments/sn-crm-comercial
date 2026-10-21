-- Rollback de 142: quita la provisión de ingresos por tercero y devuelve la función de la 122.
drop view if exists public.siio_financial_revenue_lines_current;
drop table if exists public.siio_financial_revenue_lines;

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
    case when exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload->'validations', '[]'::jsonb)) validation_row
      where validation_row->>'severity' = 'bloqueante'
        and coalesce((validation_row->>'ok')::boolean, false) is false
    ) then 'con_errores' else 'listo_revision' end,
    p_payload->>'parser_version',
    p_payload->>'structure_signature',
    coalesce(p_payload->'structure', '{}'::jsonb),
    coalesce(p_payload->'structure_diff', '{}'::jsonb),
    coalesce(p_payload->'summary', '{}'::jsonb),
    p_actor,
    null
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

revoke all on function public.siio_import_financial_workbook(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.siio_import_financial_workbook(jsonb, uuid) to service_role;
