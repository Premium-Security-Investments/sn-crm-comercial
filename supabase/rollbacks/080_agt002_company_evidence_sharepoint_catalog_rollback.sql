begin;

-- Rollback for migration 080 (AGT-002 governed SharePoint company-evidence catalog).
--
-- Removes exactly what 080 added and nothing else: the single safe snapshot RPC and the
-- two internal detail relations that back it. Everything is `if exists`, so
-- rollback -> rollback is a no-op rather than an error.
--
-- Explicitly out of scope, and never touched here:
--   * the human-approved 17-class evidence registry ingested by 061 and version-forwarded
--     to v0.3.1 by 075 — 080 only ever read it through a foreign key, so unwinding 080 must
--     leave every registry row, version and `current` flag exactly as it found them;
--   * canonical analysis state and actionable-review state, which 080 never wrote to.
--
-- The links relation is removed before the source-file relation it references, so the
-- foreign key never has to be broken by a cascade.
drop function if exists public.psi_get_agt002_company_evidence_inventory_snapshot();

drop table if exists public.psi_agt002_company_evidence_source_file_links;
drop table if exists public.psi_agt002_company_evidence_source_files;

commit;
