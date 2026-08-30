-- 077: AGT-002 canonical persistence — raise ONLY the backend service_role statement budget.
--
-- Root cause, as measured in production on 2026-08-30 (job 87e7691c-b655-4074-8855-8633d4b23ba8):
-- the analysis ran once, made exactly the two expected V3 bridge stages, and BOTH persistence
-- attempts died with SQLSTATE 57014 (persistence_statement_timeout). The retry reused the same
-- in-memory envelope and made zero additional bridge/model calls, so this is not a runtime,
-- prompt or envelope defect — it is a database request-budget defect.
--
-- What it is NOT:
--   * No evidence of lock contention for this event. statement_timeout and lock_timeout were both
--     8s at the time, so a 57014 does not by itself rule out that the statement was also waiting
--     on a lock when its clock ran out — SQLSTATE alone is not dispositive when both timers are
--     equal. What the evidence does show: this was one serialized active job with no competing
--     AGT-002 job running against the same opportunity, 076 had already removed the reproduced
--     opportunity-row FOR UPDATE that previously gave lock contention an opportunity here, and the
--     two subsequent rollback-only probes (below) completed rather than timing out waiting on a
--     lock. The canonical row stayed intact through both attempts.
--   * Not a missing index or a slow plan. Rollback-only probes against the existing canonical
--     completed and rolled back inside the budget: 1,577 ms with already-parsed JSONB, 4,305 ms
--     with a full result::text::jsonb reparse plus promotion. The trigger-equivalent whole-row
--     JSONB compare is ~593 ms.
--   * Not something the RPC can fix from the inside. Proven locally on PostgreSQL 16: a
--     function-level `SET statement_timeout='3s'` cannot EXTEND an outer statement that already
--     started under a 1s budget — pg_sleep(2) is still cancelled at 1s, because the timeout is
--     armed when the statement begins, not re-armed when the GUC changes. Setting the timeout
--     inside psi_record_agt002_canonical_analysis_run is therefore a no-op by construction.
--
-- What it IS: the COMPLETE PostgREST request budget for a ~6 MB nested JSON payload — jsonb
-- coercion of the bound parameter, the append-only trigger's whole-row compare, and the atomic
-- demote/insert promotion with its TOAST write — crossing the 8s statement_timeout the backend
-- role runs under. The existing canonical is 5,976,497 text bytes / 2,293,822 storage bytes, and
-- pg_stat_statements tops out at 5,176.498 ms for SUCCESSFUL executions (cancelled statements are
-- never counted, so that figure is a floor for the failing path, not a ceiling).
--
-- The fix, deliberately the smallest one that can work: PostgREST applies per-role settings from
-- pg_db_role_setting to the impersonated role on every request, so `alter role ... set` is the
-- only lever that can widen a budget the statement has already been armed with. This migration
-- raises statement_timeout to a bounded 30s for the BACKEND role only (service_role), leaving every
-- human-facing role on its own existing budget, unchanged by this migration: anon at 3s and
-- authenticated at 8s. service_role itself carries no explicit pg_db_role_setting entry before this
-- migration runs — its effective 8s statement/lock budget today is inherited and applied by
-- PostgREST, not a pinned catalog row. This migration is the first to pin it explicitly.
--
-- lock_timeout stays pinned at 8s, explicitly and in the same migration, so the wider statement
-- budget can never be spent waiting on a lock: a real contention incident must still fail fast
-- with 55P03 in 8s instead of hanging for 30s. Raising lock_timeout is the failure mode this
-- change is most likely to be mis-copied into, so it is asserted below and in the focused tests.
--
-- Explicitly unchanged: the atomic one-RPC persistence path, the immutable/append-only and
-- canonical (one canonical completed run per opportunity) invariants, the 067 V3 payload gates,
-- the human-authorised enqueue path, the in-memory persistence retry policy, every grant, every
-- RLS policy, and every table, column, index, trigger and function. This migration touches no
-- schema object and no row: its entire effect is two GUC entries on one role.
--
-- Rollback: supabase/rollbacks/077_agt002_canonical_persistence_statement_timeout_rollback.sql
-- RESETs both managed GUCs, restoring the EXACT pre-077 catalog posture: no explicit
-- pg_db_role_setting entry for statement_timeout or lock_timeout on service_role at all. Effective
-- behaviour returns to whichever budget PostgREST/the authenticator session applies by
-- inheritance — today that is 8s/8s, but the rollback deliberately does not pin that value, so a
-- future change to the inherited default is followed rather than silently overwritten back to 8s.
-- Any OTHER, unrelated role-level GUC on service_role is left untouched by the RESETs.
begin;

alter role service_role set statement_timeout = '30s';
alter role service_role set lock_timeout = '8s';

-- Fail-closed verification, inside the same transaction: if the intended pair is not exactly what
-- pg_db_role_setting now holds for service_role, abort so nothing is committed half-applied.
do $agt002_077_verify$
declare
  v_config text[];
  v_statement_timeout text;
  v_lock_timeout text;
begin
  -- A per-database statement_timeout or lock_timeout setting overrides the cluster-wide one, so a
  -- stray `alter role service_role in database ... set statement_timeout` would silently defeat this
  -- migration. Refuse to pretend the budget was raised when it was not. Scoped to just these two
  -- GUCs so an unrelated per-database service_role setting (e.g. work_mem) never blocks 077.
  if exists (
    select 1
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    cross join lateral unnest(s.setconfig) entry
    where r.rolname = 'service_role'
      and s.setdatabase <> 0
      and split_part(entry, '=', 1) in ('statement_timeout', 'lock_timeout')
  ) then
    raise exception 'service_role tiene un ajuste de statement_timeout o lock_timeout por base de datos que anularía este cambio; resuélvalo antes de aplicar 077.' using errcode = '22023';
  end if;

  select s.setconfig into v_config
    from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
   where r.rolname = 'service_role' and s.setdatabase = 0;

  select split_part(entry, '=', 2) into v_statement_timeout
    from unnest(coalesce(v_config, '{}'::text[])) entry where split_part(entry, '=', 1) = 'statement_timeout';
  select split_part(entry, '=', 2) into v_lock_timeout
    from unnest(coalesce(v_config, '{}'::text[])) entry where split_part(entry, '=', 1) = 'lock_timeout';

  if v_statement_timeout is distinct from '30s' or v_lock_timeout is distinct from '8s' then
    raise exception '077 no dejó service_role en statement_timeout=30s con lock_timeout=8s (observado: %).', coalesce(v_config::text, '<sin ajustes de rol>')
      using errcode = '22023';
  end if;
end
$agt002_077_verify$;

-- PostgREST caches role settings with its configuration; without this the running instance keeps
-- applying the old 8s budget until it is restarted.
notify pgrst, 'reload config';

commit;
