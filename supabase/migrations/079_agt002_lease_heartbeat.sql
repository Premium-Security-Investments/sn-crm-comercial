-- AGT-002 fenced lease heartbeat: strictly additive. Adds exactly two SECURITY DEFINER
-- renewal RPCs beside the reservations migrations 028 and 068 already created:
--   * psi_renew_agt002_preview_claim(text, uuid, integer) extends psi_agt002_preview_claims,
--     fenced by BOTH idempotency_key and the claim_id token.
--   * psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) extends
--     psi_agt002_reanalysis_jobs, fenced by BOTH id and the lease_id token, and only while the
--     job is still 'running'.
-- Neither RPC creates, deletes or reads anything beyond the single fenced row it extends. Both
-- reject an already-expired lease instead of resurrecting it (someone else may already own the
-- reservation), and both accept identity and a bounded lease duration only — never a message, a
-- result, a prompt or any other free-text/JSONB payload. Neither migration 028 nor 068 is
-- touched: this file only adds beside them.
begin;

create or replace function public.psi_renew_agt002_preview_claim(
  p_idempotency_key text,
  p_claim_id uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated public.psi_agt002_preview_claims%rowtype;
begin
  if nullif(btrim(p_idempotency_key), '') is null or p_claim_id is null then
    raise exception 'La renovación de la reserva AGT-002 Preview no es válida.' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 600 then
    raise exception 'La duración de renovación de la reserva AGT-002 Preview no es válida.' using errcode = '22023';
  end if;

  update public.psi_agt002_preview_claims
  set lease_expires_at = v_now + make_interval(secs => p_lease_seconds)
  where idempotency_key = p_idempotency_key
    and claim_id = p_claim_id
    and lease_expires_at > v_now
  returning * into v_updated;

  if not found then
    -- Already expired (or reclaimed by someone else): never resurrect it.
    return jsonb_build_object('status', 'lost');
  end if;

  return jsonb_build_object('status', 'renewed', 'lease_expires_at', v_updated.lease_expires_at);
end;
$$;

create or replace function public.psi_renew_agt002_reanalysis_job_lease(
  p_job_id uuid,
  p_lease_id uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated public.psi_agt002_reanalysis_jobs%rowtype;
begin
  if p_job_id is null or p_lease_id is null then
    raise exception 'La renovación de la reserva del job de reanálisis AGT-002 no es válida.' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 600 then
    raise exception 'La duración de renovación de la reserva del job de reanálisis AGT-002 no es válida.' using errcode = '22023';
  end if;

  update public.psi_agt002_reanalysis_jobs
  set lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
  where id = p_job_id
    and lease_id = p_lease_id
    and status = 'running'
    and lease_expires_at > v_now
  returning * into v_updated;

  if not found then
    -- Already expired, already reclaimed, or no longer running: never resurrect it.
    return jsonb_build_object('status', 'lost');
  end if;

  return jsonb_build_object('status', 'renewed', 'lease_expires_at', v_updated.lease_expires_at);
end;
$$;

revoke all on function public.psi_renew_agt002_preview_claim(text, uuid, integer) from public;
revoke all on function public.psi_renew_agt002_preview_claim(text, uuid, integer) from anon;
revoke all on function public.psi_renew_agt002_preview_claim(text, uuid, integer) from authenticated;
revoke all on function public.psi_renew_agt002_preview_claim(text, uuid, integer) from service_role;
grant execute on function public.psi_renew_agt002_preview_claim(text, uuid, integer) to service_role;

revoke all on function public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) from public;
revoke all on function public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) from anon;
revoke all on function public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) from authenticated;
revoke all on function public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) from service_role;
grant execute on function public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) to service_role;

commit;
