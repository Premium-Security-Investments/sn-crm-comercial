-- =============================================================================
-- AGT-002 Phase 01 — Executable Gate / Authority Grant / Consumption Receipt
-- STORAGE DESIGN (NOT APPLIED)
-- =============================================================================
--
-- STATUS: DESIGN ONLY. This file is a design artifact, not a migration.
-- DO NOT APPLY this file to any database, in any environment, by any tool.
-- It intentionally lives outside supabase/migrations/ so no migration runner
-- will ever pick it up automatically.
--
-- Purpose: propose the fail-closed DDL for the AGT-002 Phase 01 executable
-- control surface — gate instances, authority grants, and single-use
-- consumption receipts — for review before any real migration is authored.
--
-- If this file is ever executed by mistake (psql -f, a migration tool, a
-- copy/paste into a SQL console), the guard block immediately below aborts
-- the whole batch before any DDL below it can run.
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION 'DO NOT APPLY: supabase/migration-designs/agt002_phase01_executable_controls.sql is a DESIGN ONLY artifact (NOT APPLIED, NOT a migration). Aborting to stay fail-closed.';
END $$;

-- The guard above always raises, so nothing past this point ever executes in
-- practice. Everything below is nonetheless wrapped in an explicit
-- transaction that ends in ROLLBACK, so that even a manual, guard-bypassed
-- run (e.g. someone deleting the DO block first) can never persist anything.

BEGIN;

-- -----------------------------------------------------------------------------
-- proposed_agt002_authority_grants
--
-- Durable record of "who/what may authorize gates of a given type, and under
-- what scope/expiry". Created before proposed_agt002_gate_instances because
-- gate instances reference a grant. Append-mostly: rows are revoked in place
-- via revoked_at_utc, never deleted (ON DELETE RESTRICT everywhere they are
-- referenced).
-- -----------------------------------------------------------------------------
CREATE TABLE proposed_agt002_authority_grants (
  grant_id text PRIMARY KEY,
  registry_version int NOT NULL CHECK (registry_version >= 1),
  gate_type text NOT NULL,
  principal_id text NOT NULL,
  principal_kind text NOT NULL CHECK (principal_kind IN ('human', 'agent', 'synthetic')),
  durable_ref jsonb NOT NULL,
  delegate_of text REFERENCES proposed_agt002_authority_grants(grant_id) ON DELETE RESTRICT,
  valid_from_utc timestamptz NOT NULL,
  valid_until_utc timestamptz NOT NULL CHECK (valid_until_utc > valid_from_utc),
  scope jsonb NOT NULL,
  revoked_at_utc timestamptz,
  revoked_by text,
  revoked_reason text,
  created_at_utc timestamptz NOT NULL,
  CHECK (
    (revoked_at_utc IS NULL AND revoked_by IS NULL AND revoked_reason IS NULL)
    OR (revoked_at_utc IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

COMMENT ON TABLE proposed_agt002_authority_grants IS
  'DESIGN ONLY / NOT APPLIED. Proposed durable authority-grant registry for AGT-002 Phase 01 gates.';

ALTER TABLE proposed_agt002_authority_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE proposed_agt002_authority_grants FROM PUBLIC;
REVOKE ALL ON TABLE proposed_agt002_authority_grants FROM anon;
REVOKE ALL ON TABLE proposed_agt002_authority_grants FROM authenticated;

-- -----------------------------------------------------------------------------
-- proposed_agt002_gate_instances
--
-- One row per issued gate. Lifecycle (status) and result (outcome) are kept
-- as two separate columns on purpose: a gate can be DRAFT/OPEN/EXPIRED/
-- REVOKED with no result yet, but the instant it reaches CONSUMED it must
-- carry a terminal outcome. See the trailing CHECK for that separation.
-- -----------------------------------------------------------------------------
CREATE TABLE proposed_agt002_gate_instances (
  gate_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'agt002-phase01-gate/1.0.0'),
  type text NOT NULL CHECK (type IN ('PHASE_AUDIT', 'LINK_VERIFICATION', 'AUTHORITY_DELEGATION', 'STORAGE_DESIGN_REVIEW', 'PRODUCTION_ACTION')),
  grant_id text NOT NULL REFERENCES proposed_agt002_authority_grants(grant_id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('production', 'isolated_fixture')),
  objective text NOT NULL CHECK (btrim(objective) <> ''),
  issued_at_utc timestamptz NOT NULL,
  expires_at_utc timestamptz NOT NULL CHECK (expires_at_utc > issued_at_utc),
  status text NOT NULL CHECK (status IN ('DRAFT', 'OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED')),
  outcome text CHECK (outcome IN ('PASS', 'REJECTED', 'CANCELLED')),
  artifact_set_hash text NOT NULL CHECK (artifact_set_hash ~ '^[0-9a-f]{64}$'),
  scope jsonb NOT NULL,
  preconditions jsonb NOT NULL,
  evidence jsonb NOT NULL,
  rollback jsonb NOT NULL,
  created_at_utc timestamptz NOT NULL,
  updated_at_utc timestamptz NOT NULL,
  -- Lifecycle/outcome separation: outcome is null while the gate is still
  -- active (DRAFT/OPEN/EXPIRED/REVOKED); outcome becomes mandatory the
  -- moment the gate is CONSUMED. This is the "active case is null" rule.
  CHECK (
    (status IN ('DRAFT', 'OPEN', 'EXPIRED', 'REVOKED') AND outcome IS NULL)
    OR (status = 'CONSUMED' AND outcome IS NOT NULL)
  )
);

COMMENT ON TABLE proposed_agt002_gate_instances IS
  'DESIGN ONLY / NOT APPLIED. Proposed executable-gate instance store for AGT-002 Phase 01.';

CREATE INDEX proposed_agt002_gate_instances_grant_id_idx
  ON proposed_agt002_gate_instances (grant_id);
CREATE INDEX proposed_agt002_gate_instances_status_idx
  ON proposed_agt002_gate_instances (status);

ALTER TABLE proposed_agt002_gate_instances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE proposed_agt002_gate_instances FROM PUBLIC;
REVOKE ALL ON TABLE proposed_agt002_gate_instances FROM anon;
REVOKE ALL ON TABLE proposed_agt002_gate_instances FROM authenticated;

-- -----------------------------------------------------------------------------
-- proposed_agt002_gate_consumption_receipts
--
-- Append-only proof that a specific gate was consumed exactly once.
-- receipt_id is globally unique via PRIMARY KEY; UNIQUE(gate_id) below is the
-- max_consumptions=1 enforcement (a gate can never be consumed twice).
-- -----------------------------------------------------------------------------
CREATE TABLE proposed_agt002_gate_consumption_receipts (
  receipt_id text PRIMARY KEY,
  gate_id text NOT NULL REFERENCES proposed_agt002_gate_instances(gate_id) ON DELETE RESTRICT,
  consumed_at_utc timestamptz NOT NULL,
  consumed_by text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('PASS', 'REJECTED', 'CANCELLED')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  notes text,
  created_at_utc timestamptz NOT NULL,
  UNIQUE (gate_id)
);

COMMENT ON TABLE proposed_agt002_gate_consumption_receipts IS
  'DESIGN ONLY / NOT APPLIED. Proposed single-use, append-only consumption receipt store for AGT-002 Phase 01 gates. One receipt per gate_id, enforced by UNIQUE(gate_id).';

ALTER TABLE proposed_agt002_gate_consumption_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE proposed_agt002_gate_consumption_receipts FROM PUBLIC;
REVOKE ALL ON TABLE proposed_agt002_gate_consumption_receipts FROM anon;
REVOKE ALL ON TABLE proposed_agt002_gate_consumption_receipts FROM authenticated;

-- -----------------------------------------------------------------------------
-- Fail-closed access posture: service_role only, via SECURITY DEFINER check.
--
-- Every table above has row level security enabled and every non-service
-- grant (PUBLIC/anon/authenticated) has been revoked. The only way in is a
-- narrow SECURITY DEFINER predicate function, pinned to a fixed search_path
-- to avoid search_path hijacking, gating a single service_role policy per
-- table. There is no INSERT/UPDATE/DELETE policy for anon/authenticated by
-- design — absence of a policy is itself a deny under RLS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION proposed_agt002_is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.role() = 'service_role';
$$;

REVOKE ALL ON FUNCTION proposed_agt002_is_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION proposed_agt002_is_service_role() FROM anon;
REVOKE ALL ON FUNCTION proposed_agt002_is_service_role() FROM authenticated;
GRANT EXECUTE ON FUNCTION proposed_agt002_is_service_role() TO service_role;

CREATE POLICY proposed_agt002_authority_grants_service_role_only
  ON proposed_agt002_authority_grants
  FOR ALL
  TO service_role
  USING (proposed_agt002_is_service_role())
  WITH CHECK (proposed_agt002_is_service_role());

CREATE POLICY proposed_agt002_gate_instances_service_role_only
  ON proposed_agt002_gate_instances
  FOR ALL
  TO service_role
  USING (proposed_agt002_is_service_role())
  WITH CHECK (proposed_agt002_is_service_role());

CREATE POLICY proposed_agt002_gate_consumption_receipts_service_role_only
  ON proposed_agt002_gate_consumption_receipts
  FOR ALL
  TO service_role
  USING (proposed_agt002_is_service_role())
  WITH CHECK (proposed_agt002_is_service_role());

-- -----------------------------------------------------------------------------
-- Append-only enforcement for receipts: reject direct UPDATE/DELETE, even
-- from service_role, at the trigger level. Corrections must be modeled as a
-- new receipt row, never a mutation of an existing one.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION proposed_agt002_receipts_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'append-only: direct UPDATE or DELETE against proposed_agt002_gate_consumption_receipts is not permitted; corrections must be issued as a new receipt row';
END;
$$;

CREATE TRIGGER proposed_agt002_gate_consumption_receipts_append_only
  BEFORE UPDATE OR DELETE ON proposed_agt002_gate_consumption_receipts
  FOR EACH ROW EXECUTE FUNCTION proposed_agt002_receipts_append_only_guard();

-- =============================================================================
-- End of proposed DDL. This design is fail-closed by construction:
--   * the guard DO block at the top always raises and aborts before any DDL,
--   * RLS is enabled with every non-service grant revoked on all three
--     tables, leaving zero implicit access,
--   * the only access path is a pinned-search_path SECURITY DEFINER
--     predicate limited to service_role,
--   * receipts are append-only (UPDATE/DELETE trigger-blocked) and
--     single-use per gate via UNIQUE(gate_id),
--   * and, regardless of any of the above, this whole batch ends in ROLLBACK
--     so nothing it contains can ever be committed by running this file.
-- No seed data, no DML, no endpoints, and no credentials are included here.
-- =============================================================================

ROLLBACK;
