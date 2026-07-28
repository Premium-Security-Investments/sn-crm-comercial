begin;

create or replace function public.psi_record_tender_import_item(
  p_job_id uuid,
  p_source text,
  p_source_document_id text,
  p_source_url text,
  p_name text,
  p_status text,
  p_critical boolean,
  p_document_version_id uuid,
  p_last_error_code text,
  p_last_error_message text,
  p_next_attempt_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.psi_tender_processing_jobs%rowtype;
  v_item_id uuid;
  v_is_failure boolean;
begin
  select * into v_job from public.psi_tender_processing_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'psi_record_tender_import_item: job % no encontrado', p_job_id;
  end if;

  if p_status not in ('pending','processing','imported','unchanged','failed_retryable','failed_terminal') then
    raise exception 'psi_record_tender_import_item: status inválido %', p_status;
  end if;
  if p_status = 'failed_retryable' and p_next_attempt_at is null then
    raise exception 'psi_record_tender_import_item: failed_retryable requiere next_attempt_at';
  end if;
  v_is_failure := p_status in ('failed_retryable', 'failed_terminal');

  insert into public.psi_tender_document_import_items
    (job_id, tender_id, opportunity_id, source, source_document_id, source_url, name, status,
     critical, attempt_count, next_attempt_at, document_version_id, last_error_code, last_error_message)
  values
    (p_job_id, v_job.tender_id, v_job.opportunity_id, p_source, p_source_document_id, p_source_url, p_name,
     p_status, coalesce(p_critical, false), case when v_is_failure then 1 else 0 end,
     case when p_status = 'failed_retryable' then p_next_attempt_at else null end,
     p_document_version_id, p_last_error_code, p_last_error_message)
  on conflict (job_id, source, source_document_id) do update set
    source_url = coalesce(excluded.source_url, public.psi_tender_document_import_items.source_url),
    name = excluded.name,
    status = excluded.status,
    critical = excluded.critical,
    attempt_count = case
      when excluded.status in ('failed_retryable', 'failed_terminal')
        then public.psi_tender_document_import_items.attempt_count + 1
      else public.psi_tender_document_import_items.attempt_count
    end,
    next_attempt_at = case
      when excluded.status = 'failed_retryable' then excluded.next_attempt_at
      else null
    end,
    document_version_id = coalesce(excluded.document_version_id, public.psi_tender_document_import_items.document_version_id),
    last_error_code = excluded.last_error_code,
    last_error_message = excluded.last_error_message,
    updated_at = now()
  returning id into v_item_id;

  return jsonb_build_object('status', 'ok', 'id', v_item_id);
end;
$$;

revoke all on function public.psi_record_tender_import_item(uuid, text, text, text, text, text, boolean, uuid, text, text, timestamptz) from public, authenticated, anon;
grant execute on function public.psi_record_tender_import_item(uuid, text, text, text, text, text, boolean, uuid, text, text, timestamptz) to service_role;

commit;
