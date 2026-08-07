begin;

-- 064 introduces psi_agt002_integral_governance_overrides as a brand-new, self-contained
-- table: nothing else in the schema depends on it, and no prior migration's behavior
-- changes when it disappears. agt002-integral-governance-overrides.js's loader is
-- fail-soft on this table's absence (PGRST205 / 42P01), so dropping it here is a safe,
-- complete revert — every opportunity's requirements simply fall back to the empty
-- categoryOverrides/evidenceClassLinkByRequirementId maps they already used before this
-- migration (the same fail-closed safe-unknown abstention). A single DROP TABLE IF
-- EXISTS is used deliberately, mirroring 061's rollback: it cascades to the table's own
-- trigger and grants, so it is safe to run whether or not 064 was ever applied.
drop table if exists public.psi_agt002_integral_governance_overrides;

commit;
