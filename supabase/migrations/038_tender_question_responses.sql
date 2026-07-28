-- Append-only human responses to Vig-IA analysis questions.
-- Responses never mutate the analysis run and never authorize GO / NO GO.
begin;

create table if not exists public.psi_tender_question_responses (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  analysis_run_id uuid not null references public.psi_tender_analysis_runs(id) on delete restrict,
  question_id text not null check (nullif(btrim(question_id), '') is not null and length(question_id) <= 200),
  question_text text not null check (nullif(btrim(question_text), '') is not null and length(question_text) <= 2000),
  status text not null check (status in ('pending', 'resolved', 'not_applicable')),
  response text not null check (nullif(btrim(response), '') is not null and length(response) <= 10000),
  evidence_notes text check (evidence_notes is null or length(evidence_notes) <= 5000),
  responded_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  responded_at timestamptz not null default now()
);

create index if not exists psi_tender_question_responses_lookup_idx
  on public.psi_tender_question_responses (opportunity_id, analysis_run_id, question_id, responded_at desc, id desc);

create or replace function public.psi_tender_question_responses_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'psi_tender_question_responses is append-only: UPDATE and DELETE are prohibited';
end;
$$;

drop trigger if exists psi_tender_question_responses_immutable on public.psi_tender_question_responses;
create trigger psi_tender_question_responses_immutable
  before update or delete on public.psi_tender_question_responses
  for each row execute function public.psi_tender_question_responses_prevent_mutation();

alter table public.psi_tender_question_responses enable row level security;
revoke all on table public.psi_tender_question_responses from public;
revoke all on table public.psi_tender_question_responses from anon;
revoke all on table public.psi_tender_question_responses from authenticated;
revoke all on table public.psi_tender_question_responses from service_role;
grant select on table public.psi_tender_question_responses to service_role;

create or replace function public.psi_record_tender_question_response(
  p_opportunity_id uuid,
  p_analysis_run_id uuid,
  p_question_id text,
  p_question_text text,
  p_status text,
  p_response text,
  p_evidence_notes text,
  p_responded_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.psi_tender_analysis_runs%rowtype;
  v_actor public.psi_sales_profiles%rowtype;
  v_response public.psi_tender_question_responses%rowtype;
begin
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

  insert into public.psi_tender_question_responses (
    opportunity_id, analysis_run_id, question_id, question_text, status,
    response, evidence_notes, responded_by
  ) values (
    p_opportunity_id, p_analysis_run_id, btrim(p_question_id), btrim(p_question_text), p_status,
    btrim(p_response), nullif(btrim(coalesce(p_evidence_notes, '')), ''), p_responded_by
  ) returning * into v_response;

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
    'responded_at', v_response.responded_at
  );
end;
$$;

revoke all on function public.psi_record_tender_question_response(uuid,uuid,text,text,text,text,text,uuid) from public;
revoke all on function public.psi_record_tender_question_response(uuid,uuid,text,text,text,text,text,uuid) from anon;
revoke all on function public.psi_record_tender_question_response(uuid,uuid,text,text,text,text,text,uuid) from authenticated;
grant execute on function public.psi_record_tender_question_response(uuid,uuid,text,text,text,text,text,uuid) to service_role;

commit;
