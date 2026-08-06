begin;

-- 061 introduces psi_agt002_company_evidence_registry as a brand-new, self-contained
-- table: nothing else in the schema depends on it and no prior migration's behavior
-- changes when it disappears. agt002-company-dossier.js's loader is fail-soft on this
-- table's absence (PGRST205 / 42P01), so dropping it here is a safe, complete revert to
-- the pre-061 state — the dossier simply falls back to the psi_company_procurement_profile
-- scalar text it already used before this hotfix. A single DROP TABLE IF EXISTS is used
-- deliberately: it already cascades to the table's own trigger and grants, so it is safe
-- to run whether or not 061 was ever applied. A separate leading DROP TRIGGER/REVOKE (as
-- other rollbacks in this repo use for objects that must survive) is intentionally NOT
-- used here — unlike those, "IF EXISTS" only protects the trigger/grant name, not the
-- table it references, so re-running it after the table is already gone would fail with
-- 42P01 instead of being idempotent.
drop table if exists public.psi_agt002_company_evidence_registry;

commit;
