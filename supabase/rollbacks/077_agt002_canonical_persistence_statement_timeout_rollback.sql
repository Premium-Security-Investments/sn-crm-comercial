-- Revert 077: put the backend service_role statement budget back to its pre-077 EFFECTIVE value.
--
-- This restores the effective pre-077 behaviour (statement_timeout=8s, lock_timeout=8s), not the
-- exact pre-077 catalog posture: before 077 ran, service_role carried no explicit
-- pg_db_role_setting entry at all, and its 8s statement/lock budget was inherited and applied by
-- PostgREST rather than pinned. This rollback creates explicit, versioned entries instead of
-- RESETting back to that inherited state, so the reverted posture no longer depends on whatever the
-- authenticator/session default happens to be — but it is a deliberately different catalog state
-- from the one that existed before 077, not a bit-for-bit reversion.
--
-- Because this pins an explicit value, running this rollback after any OTHER, unrelated change to
-- service_role's statement_timeout or lock_timeout (made outside this 077/rollback pair) will
-- silently overwrite that change back to 8s/8s. Inspect the current service_role row in
-- pg_db_role_setting before running this rollback in an environment where the role's timeout
-- configuration may have moved since 077 applied.
--
-- lock_timeout is re-asserted at 8s, never raised: reverting the statement budget must not widen
-- the lock budget as a side effect.
--
-- Consequence of running this: AGT-002 canonical persistence of a ~6 MB V3 payload returns to
-- failing with SQLSTATE 57014 (persistence_statement_timeout) on both attempts, exactly as
-- observed on 2026-08-30. Use it only to undo 077, not as an incident mitigation.
--
-- No schema object and no row is touched here either.
begin;

alter role service_role set statement_timeout = '8s';
alter role service_role set lock_timeout = '8s';

do $agt002_077_rollback_verify$
declare
  v_config text[];
  v_statement_timeout text;
  v_lock_timeout text;
begin
  -- Scoped to just statement_timeout/lock_timeout, matching the narrowed guard in 077 itself — an
  -- unrelated per-database service_role setting must never block this rollback either.
  if exists (
    select 1
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    cross join lateral unnest(s.setconfig) entry
    where r.rolname = 'service_role'
      and s.setdatabase <> 0
      and split_part(entry, '=', 1) in ('statement_timeout', 'lock_timeout')
  ) then
    raise exception 'service_role tiene un ajuste de statement_timeout o lock_timeout por base de datos que anularía esta reversión; resuélvalo antes de revertir 077.' using errcode = '22023';
  end if;

  select s.setconfig into v_config
    from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
   where r.rolname = 'service_role' and s.setdatabase = 0;

  select split_part(entry, '=', 2) into v_statement_timeout
    from unnest(coalesce(v_config, '{}'::text[])) entry where split_part(entry, '=', 1) = 'statement_timeout';
  select split_part(entry, '=', 2) into v_lock_timeout
    from unnest(coalesce(v_config, '{}'::text[])) entry where split_part(entry, '=', 1) = 'lock_timeout';

  if v_statement_timeout is distinct from '8s' or v_lock_timeout is distinct from '8s' then
    raise exception 'La reversión de 077 no dejó service_role en statement_timeout=8s con lock_timeout=8s (observado: %).', coalesce(v_config::text, '<sin ajustes de rol>')
      using errcode = '22023';
  end if;
end
$agt002_077_rollback_verify$;

notify pgrst, 'reload config';

commit;
