begin;

-- Reversa operativa de 122. Falla cerrado si ya existe un cargue: nunca borra
-- cortes contables ni métricas para volver al esquema anterior.
do $$
begin
  if to_regclass('public.siio_financial_imports') is not null
     and exists (select 1 from public.siio_financial_imports) then
    raise exception 'rollback_122_refuses_existing_financial_imports'
      using errcode = '55000';
  end if;
end
$$;

drop view if exists public.siio_financial_metrics_current;
drop function if exists public.siio_publish_financial_import(uuid, uuid);
drop function if exists public.siio_validate_financial_import(uuid, uuid);
drop function if exists public.siio_import_financial_workbook(jsonb, uuid);

drop index if exists public.uq_siio_financial_metric_import_concept;
drop index if exists public.uq_siio_financial_metric_legacy_period_concept_source;

alter table public.siio_financial_metrics
  drop column if exists source_cell,
  drop column if exists source_sheet,
  drop column if exists figure_type,
  drop column if exists base_value,
  drop column if exists import_id;

create unique index if not exists uq_siio_financial_metric_period_concept_source
  on public.siio_financial_metrics(period_month, concept, source_id);

drop table if exists public.siio_financial_validations;
drop table if exists public.siio_financial_balance_lines;
drop table if exists public.siio_financial_imports;

-- Sólo retira el bucket creado por 122 cuando no contiene objetos. La migración
-- falla si el identificador ya existía, de modo que la reversa no toma propiedad
-- de un bucket preexistente.
do $storage_bucket$
begin
  if to_regclass('storage.buckets') is not null then
    if to_regclass('storage.objects') is null then
      execute $sql$
        delete from storage.buckets where id = 'siio-financial-imports'
      $sql$;
    else
      -- La consulta sobre storage.objects debe ser dinámica: ese esquema no
      -- existe en PGlite ni en instalaciones de Supabase incompletas.
      execute $sql$
        delete from storage.buckets b
        where b.id = 'siio-financial-imports'
          and not exists (
            select 1 from storage.objects o where o.bucket_id = b.id
          )
      $sql$;
    end if;
  end if;
end
$storage_bucket$;

commit;
