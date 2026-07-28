-- Business timeline for tender GO / NO GO decisions.
-- Wraps the audited eight-argument decision RPC from migration 027 without changing
-- its authorization, document-hash, preparation or offer-status behavior.
begin;

do $$
begin
  if to_regprocedure('public.psi_record_tender_go_no_go_core_039(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
    if to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)') is null then
      raise exception 'Migration 039 requires the audited eight-argument psi_record_tender_go_no_go RPC.';
    end if;
    execute 'alter function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) rename to psi_record_tender_go_no_go_core_039';
  end if;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go_core_039(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go_core_039(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go_core_039(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go_core_039(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;

create or replace function public.psi_record_tender_go_no_go(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_analysis_run_id uuid,
  p_justification text,
  p_preparation jsonb,
  p_document_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_decision_id uuid;
  v_preparation_id uuid;
begin
  v_result := public.psi_record_tender_go_no_go_core_039(
    p_opportunity_id,
    p_tender_id,
    p_actor_id,
    p_decision,
    p_analysis_run_id,
    p_justification,
    p_preparation,
    p_document_hash
  );

  v_decision_id := nullif(v_result->>'decision_id', '')::uuid;
  v_preparation_id := nullif(v_result->>'preparation_id', '')::uuid;

  perform public.psi_append_tender_tracking_event(
    p_tender_id,
    case when p_decision = 'go' then 'go_decided' else 'no_go_decided' end,
    'human',
    p_actor_id,
    'go_no_go_decision',
    v_decision_id,
    jsonb_strip_nulls(jsonb_build_object(
      'opportunity_id', p_opportunity_id,
      'decision', p_decision,
      'analysis_run_id', p_analysis_run_id,
      'tender_offer_status', v_result->>'tender_offer_status'
    )),
    nullif(btrim(p_justification), ''),
    true
  );

  if p_decision = 'go' and v_preparation_id is not null then
    perform public.psi_append_tender_tracking_event(
      p_tender_id,
      'offer_preparation_started',
      'human',
      p_actor_id,
      'tender_offer_preparation',
      v_preparation_id,
      jsonb_build_object(
        'opportunity_id', p_opportunity_id,
        'decision_id', v_decision_id,
        'preparation_created', coalesce((v_result->>'preparation_created')::boolean, false)
      ),
      'El expediente de oferta quedó habilitado para preparación.',
      true
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from public;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from anon;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from authenticated;
revoke all on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) from service_role;
grant execute on function public.psi_record_tender_go_no_go(uuid, uuid, uuid, text, uuid, text, jsonb, text) to service_role;

commit;
