begin;

-- AGT-002 integral v3 (F1/F2 follow-up): a governed, human-curated source for the two
-- maps the v3 engine (agt002-preview-engine.js) requires as explicit constructor
-- configuration and never invents on its own:
--   category_override   -> agt002-integral-category-manifest.js's categoryOverrides
--                           (requirement_id -> discard|habilitating|technical|financial_execution),
--                           required whenever a requirement's front has no honest 1:1
--                           mapping (front: 'legal' today).
--   evidence_class_link  -> agt002-evidence-state-manifest.js's evidenceClassLinkByRequirementId
--                           (requirement_id -> one of the 17 psi_agt002_company_evidence_registry
--                           (061) class ids), required for a requirement's five evidence axes
--                           to ever leave the safe-unknown abstention state.
-- Both maps are scoped per opportunity_id because requirement_id is generated per pliego
-- extraction (agt002-deep-analysis-matrix.js), not globally stable across opportunities.
-- This table stores curated decisions only — never a computed/inferred value: every row
-- carries a mandatory rationale, a source_reference (traceable to the real pliego clause
-- or the human decision that grounds it) and the curator's identity. Nothing here is
-- derived from document presence, keyword matching or model inference; a row that cannot
-- honestly cite its rationale/source must not be inserted.
--
-- No RPC/write path is added here, matching 061's own posture: this is a migration/
-- human-owned curation surface, not a runtime-writable table. Curating a real opportunity's
-- overrides is a deliberate, reviewed, append-only act — the same discipline already
-- applied to the 17-class registry itself.
create table if not exists public.psi_agt002_integral_governance_overrides (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  requirement_id text not null check (nullif(btrim(requirement_id), '') is not null),
  override_kind text not null check (override_kind in ('category_override', 'evidence_class_link')),
  category_value text check (category_value in ('discard', 'habilitating', 'technical', 'financial_execution')),
  evidence_class_id text check (evidence_class_id in (
    'supervigilancia_operating_license', 'rup', 'rut', 'communications_license',
    'uniforms_resolution', 'no_fines_sanctions_certificate', 'authorized_weapons_list',
    'rce_policy', 'collective_life_policy', 'accredited_experience',
    'financial_and_tax_pack', 'bank_certificate', 'overtime_authorization',
    'corporate_background_checks', 'legal_representative_vault',
    'personnel_credentials_vault', 'differential_scoring_support'
  )),
  rationale text not null check (nullif(btrim(rationale), '') is not null),
  source_reference text not null check (nullif(btrim(source_reference), '') is not null),
  curated_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  curated_at timestamptz not null default now(),
  current boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, requirement_id, override_kind, version),
  -- A row is exactly one kind of override: category_value is set (and evidence_class_id
  -- null) for category_override, and vice versa for evidence_class_link. This mirrors
  -- 061's own discipline of never letting one column's presence imply another's meaning.
  check (
    (override_kind = 'category_override' and category_value is not null and evidence_class_id is null)
    or
    (override_kind = 'evidence_class_link' and evidence_class_id is not null and category_value is null)
  )
);

create unique index if not exists psi_agt002_integral_governance_overrides_one_current_idx
  on public.psi_agt002_integral_governance_overrides (opportunity_id, requirement_id, override_kind)
  where current;

create index if not exists psi_agt002_integral_governance_overrides_opportunity_idx
  on public.psi_agt002_integral_governance_overrides (opportunity_id, current);

drop trigger if exists trg_psi_agt002_integral_governance_overrides_updated_at on public.psi_agt002_integral_governance_overrides;
create trigger trg_psi_agt002_integral_governance_overrides_updated_at before update on public.psi_agt002_integral_governance_overrides
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_agt002_integral_governance_overrides enable row level security;
revoke all on table public.psi_agt002_integral_governance_overrides from public;
revoke all on table public.psi_agt002_integral_governance_overrides from anon;
revoke all on table public.psi_agt002_integral_governance_overrides from authenticated;
revoke all on table public.psi_agt002_integral_governance_overrides from service_role;
grant select on table public.psi_agt002_integral_governance_overrides to service_role;

-- No seed data: unlike 061 (which ingested a reviewed corpus of 17 known entries), this
-- migration ships the empty, governed surface only. Populating a real opportunity's
-- overrides requires a human-curated, reviewed insert with a real rationale/source_reference
-- — never a bulk/automatic backfill from document presence or keyword matching.

commit;
