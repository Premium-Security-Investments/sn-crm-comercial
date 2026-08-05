-- Append-only attachments for Vig-IA analysis question responses.
-- Attachments never mutate a response and never authorize GO / NO GO.
begin;

create table if not exists public.psi_tender_question_response_attachments (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.psi_tender_question_responses(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  name text not null check (nullif(btrim(name), '') is not null and length(name) <= 140),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  )),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 25 * 1024 * 1024),
  storage_path text not null check (
    storage_path = btrim(storage_path)
    and length(storage_path) <= 512
    and storage_path like ('tender-documents/' || opportunity_id::text || '/question-responses/' || response_id::text || '/%')
    and storage_path not like '%..%'
    and position('\\' in storage_path) = 0
  ),
  uploaded_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  unique (storage_path)
);

create index if not exists psi_tender_question_response_attachments_lookup_idx
  on public.psi_tender_question_response_attachments (opportunity_id, response_id, uploaded_at desc, id desc);

create or replace function public.psi_tender_question_response_attachments_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_question_response_attachments is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_question_response_attachments_immutable on public.psi_tender_question_response_attachments;
create trigger psi_tender_question_response_attachments_immutable
  before update or delete on public.psi_tender_question_response_attachments
  for each row execute function public.psi_tender_question_response_attachments_prevent_mutation();

alter table public.psi_tender_question_response_attachments enable row level security;
revoke all on table public.psi_tender_question_response_attachments from public;
revoke all on table public.psi_tender_question_response_attachments from anon;
revoke all on table public.psi_tender_question_response_attachments from authenticated;
revoke all on table public.psi_tender_question_response_attachments from service_role;
grant select on table public.psi_tender_question_response_attachments to service_role;

create or replace function public.psi_record_tender_question_response_with_attachments(
  p_response_id uuid,
  p_opportunity_id uuid,
  p_analysis_run_id uuid,
  p_question_id text,
  p_question_text text,
  p_status text,
  p_response text,
  p_evidence_notes text,
  p_responded_by uuid,
  p_attachments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.psi_tender_analysis_runs%rowtype;
  v_actor public.psi_sales_profiles%rowtype;
  v_response public.psi_tender_question_responses%rowtype;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_attachment jsonb;
  v_name text;
  v_mime text;
  v_hash text;
  v_path text;
  v_size bigint;
  v_attachment_row public.psi_tender_question_response_attachments%rowtype;
  v_result_attachments jsonb := '[]'::jsonb;
begin
  if p_response_id is null then
    raise exception 'El identificador de la respuesta es obligatorio.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Los adjuntos deben enviarse como un arreglo.' using errcode = '22023';
  end if;
  if p_status not in ('pending', 'resolved', 'not_applicable') then
    raise exception 'El estado de la respuesta no es válido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_question_id), '') is null or length(p_question_id) > 200
     or nullif(btrim(p_question_text), '') is null or length(p_question_text) > 2000 then
    raise exception 'La duda de análisis no es válida.' using errcode = '22023';
  end if;
  if nullif(btrim(p_response), '') is null or length(p_response) > 10000 then
    raise exception 'La respuesta es obligatoria y no puede superar 10.000 caracteres.' using errcode = '22023';
  end if;
  if p_evidence_notes is not null and length(p_evidence_notes) > 5000 then
    raise exception 'La evidencia o notas no pueden superar 5.000 caracteres.' using errcode = '22023';
  end if;

  select * into v_run
  from public.psi_tender_analysis_runs
  where id = p_analysis_run_id and opportunity_id = p_opportunity_id
  for share;
  if not found then
    raise exception 'La corrida de análisis no pertenece a la oportunidad indicada.' using errcode = '22023';
  end if;

  select * into v_actor
  from public.psi_sales_profiles
  where id = p_responded_by and active is true and coalesce(identity_type, 'human') = 'human'
  for share;
  if not found then
    raise exception 'La respuesta requiere una persona humana activa.' using errcode = '42501';
  end if;

  for v_attachment in select * from jsonb_array_elements(v_attachments)
  loop
    if jsonb_typeof(v_attachment) <> 'object' then
      raise exception 'Cada adjunto debe ser un objeto JSON.' using errcode = '22023';
    end if;
    v_name := v_attachment->>'name';
    v_mime := v_attachment->>'mime_type';
    v_hash := v_attachment->>'content_hash';
    v_path := v_attachment->>'storage_path';

    if nullif(btrim(coalesce(v_name, '')), '') is null or length(v_name) > 140 then
      raise exception 'El nombre del adjunto no es válido.' using errcode = '22023';
    end if;
    if v_mime is null or v_mime not in (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ) then
      raise exception 'El tipo de archivo del adjunto no está permitido.' using errcode = '22023';
    end if;
    if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'El hash SHA-256 del adjunto no es válido.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_attachment->'size_bytes') <> 'number' then
      raise exception 'El tamaño del adjunto no es válido.' using errcode = '22023';
    end if;
    v_size := (v_attachment->>'size_bytes')::bigint;
    if v_size <= 0 or v_size > 25 * 1024 * 1024 then
      raise exception 'El tamaño del adjunto debe estar entre 1 byte y 25 MiB.' using errcode = '22023';
    end if;
    if v_path is null or btrim(v_path) <> v_path or length(v_path) > 512
       or v_path not like ('tender-documents/' || p_opportunity_id::text || '/question-responses/' || p_response_id::text || '/%')
       or v_path like '%..%' or position('\\' in v_path) > 0 then
      raise exception 'La ruta de almacenamiento del adjunto debe ser privada, pertenecer a la respuesta y no contener traversal.' using errcode = '22023';
    end if;
  end loop;

  insert into public.psi_tender_question_responses (
    id, opportunity_id, analysis_run_id, question_id, question_text, status,
    response, evidence_notes, responded_by
  ) values (
    p_response_id, p_opportunity_id, p_analysis_run_id, btrim(p_question_id), btrim(p_question_text), p_status,
    btrim(p_response), nullif(btrim(coalesce(p_evidence_notes, '')), ''), p_responded_by
  ) returning * into v_response;

  for v_attachment in select * from jsonb_array_elements(v_attachments)
  loop
    insert into public.psi_tender_question_response_attachments (
      response_id, opportunity_id, name, mime_type, content_hash, size_bytes, storage_path, uploaded_by
    ) values (
      p_response_id, p_opportunity_id, btrim(v_attachment->>'name'), v_attachment->>'mime_type',
      v_attachment->>'content_hash', (v_attachment->>'size_bytes')::bigint, v_attachment->>'storage_path', p_responded_by
    ) returning * into v_attachment_row;

    v_result_attachments := v_result_attachments || jsonb_build_array(jsonb_build_object(
      'id', v_attachment_row.id,
      'name', v_attachment_row.name,
      'mime_type', v_attachment_row.mime_type,
      'content_hash', v_attachment_row.content_hash,
      'size_bytes', v_attachment_row.size_bytes,
      'storage_path', v_attachment_row.storage_path,
      'uploaded_by', v_attachment_row.uploaded_by,
      'uploaded_at', v_attachment_row.uploaded_at
    ));
  end loop;

  return jsonb_build_object(
    'id', v_response.id,
    'opportunity_id', v_response.opportunity_id,
    'analysis_run_id', v_response.analysis_run_id,
    'question_id', v_response.question_id,
    'question_text', v_response.question_text,
    'status', v_response.status,
    'response', v_response.response,
    'evidence_notes', v_response.evidence_notes,
    'responded_by', v_response.responded_by,
    'responded_by_name', v_actor.full_name,
    'responded_at', v_response.responded_at,
    'attachments', v_result_attachments
  );
end;
$$;

revoke all on function public.psi_record_tender_question_response_with_attachments(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb) from public;
revoke all on function public.psi_record_tender_question_response_with_attachments(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb) from anon;
revoke all on function public.psi_record_tender_question_response_with_attachments(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb) from authenticated;
grant execute on function public.psi_record_tender_question_response_with_attachments(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb) to service_role;

commit;
