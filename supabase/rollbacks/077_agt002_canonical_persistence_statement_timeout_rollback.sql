-- Revert 077: restore service_role's role-level GUC catalog to its EXACT pre-077 baseline.
--
-- Before 077 ran, service_role carried no explicit pg_db_role_setting entry for statement_timeout
-- or lock_timeout at all — its 8s statement/lock budget was inherited and applied by PostgREST,
-- not pinned in the catalog. This rollback RESETs both managed GUCs rather than SETting them to a
-- literal value, so the reverted catalog posture is bit-for-bit identical to the pre-077 baseline
-- for these two settings, not merely effectively equivalent to it.
--
-- Effective behaviour after this rollback: service_role's statement/lock budget reverts to
-- whatever PostgREST/the authenticator session applies by inheritance, which today is 8s/8s. This
-- rollback deliberately does not pin that 8s value — if the inherited default ever changes in the
-- future (e.g. a cluster-wide or authenticator-role change made outside this 077/rollback pair),
-- this rollback correctly follows that new default instead of silently overwriting it back to 8s.
--
-- RESET touches only statement_timeout and lock_timeout: any OTHER, unrelated role-level or
-- per-database GUC already present on service_role (e.g. work_mem) is left exactly as it was.
--
-- Consequence of running this: AGT-002 canonical persistence of a ~6 MB V3 payload returns to
-- failing with SQLSTATE 57014 (persistence_statement_timeout) on both attempts, exactly as
-- observed on 2026-08-30. Use it only to undo 077, not as an incident mitigation.
--
-- No schema object and no row is touched here either.
begin;

alter role service_role reset statement_timeout;
alter role service_role reset lock_timeout;

do $agt002_077_rollback_verify$
declare
  v_config text[];
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

  -- Exact restoration means neither managed GUC may remain as a role-level entry — not merely that
  -- the whole row is gone, since an unrelated role-level GUC on service_role must survive intact.
  if exists (
    select 1 from unnest(coalesce(v_config, '{}'::text[])) entry
    where split_part(entry, '=', 1) in ('statement_timeout', 'lock_timeout')
  ) then
    raise exception 'La reversión de 077 no eliminó los ajustes de rol statement_timeout/lock_timeout de service_role (observado: %).', coalesce(v_config::text, '<sin ajustes de rol>')
      using errcode = '22023';
  end if;
end
$agt002_077_rollback_verify$;

notify pgrst, 'reload config';

commit;
