begin;

-- AGT-002 company evidence registry (061): version-forwards the 17 currently active
-- entries from the reviewed Base Maestra provisional v0.2
-- (source_manifest_version='v0.2-provisional-20260801') to the human-approved
-- v0.3.1 revision (source_manifest_version='v0.3.1-approved-20260829'). Append-only,
-- mirroring 061's own discipline and psi_tender_analysis_runs' canonical-true-to-false
-- supersession pattern (063): the v0.2 rows are never deleted or rewritten, only their
-- `current` flag flips to false, and every v0.3.1 row is a brand-new (entry_id, version=2)
-- row governed by the table's existing partial unique index (one current=true row per
-- entry_id). An INSERT ... SELECT copies every v0.2 column verbatim for the 13 classes
-- whose review did not change anything, instead of hand-duplicating 17 VALUES rows; only
-- the four classes whose review actually changed
-- (communications_license, financial_and_tax_pack, overtime_authorization,
-- corporate_background_checks) are overridden via a small VALUES list joined by entry_id.
--
-- No entry is promoted to verified/cumplido, applicable, or human-approved by this
-- migration: every v0.3.1 row still carries human_review_status='pending_human_review',
-- applicability_status='pending_case_validation' and null decision_humana/
-- decision_humana_fecha/estado_posterior_decision, and the same
-- internal_decision_support=true / external_submission_authority=false /
-- automatic_final_approval=false allowed_use posture as every v0.2 row. This is a
-- version-forward of the manifest, not a review outcome.
do $$
declare
  v_entry_ids constant text[] := array[
    'supervigilancia_operating_license', 'rup', 'rut', 'communications_license',
    'uniforms_resolution', 'no_fines_sanctions_certificate', 'authorized_weapons_list',
    'rce_policy', 'collective_life_policy', 'accredited_experience',
    'financial_and_tax_pack', 'bank_certificate', 'overtime_authorization',
    'corporate_background_checks', 'legal_representative_vault',
    'personnel_credentials_vault', 'differential_scoring_support'
  ];
  v_bad_count integer;
  v_current_v031_count integer;
begin
  -- Fail-closed guard: if any of the 17 entries' current row already carries a
  -- source_manifest_version this migration does not know about (neither the
  -- v0.2 baseline it supersedes nor the v0.3.1 revision it promotes to), refuse to
  -- touch anything. This is what stops the migration from time-traveling over an
  -- unknown/foreign/future manifest version that a later change may have promoted.
  select count(*) into v_bad_count
  from public.psi_agt002_company_evidence_registry
  where current
    and entry_id = any(v_entry_ids)
    and source_manifest_version not in ('v0.2-provisional-20260801', 'v0.3.1-approved-20260829');

  if v_bad_count > 0 then
    raise exception 'psi_agt002_company_evidence_registry: % current row(s) for the AGT-002 17-class manifest carry an unexpected source_manifest_version — refusing to promote to v0.3.1-approved-20260829 to avoid time-traveling over an unknown/foreign/future manifest version.', v_bad_count;
  end if;

  -- Deactivate the v0.2 baseline current rows. Append-only: current flips to false,
  -- no column is rewritten and no row is deleted.
  update public.psi_agt002_company_evidence_registry
  set current = false
  where current
    and version = 1
    and source_manifest_version = 'v0.2-provisional-20260801'
    and entry_id = any(v_entry_ids);

  -- Version-forward every v0.2 row into a new version=2, current=true,
  -- source_manifest_version='v0.3.1-approved-20260829' row. ON CONFLICT DO NOTHING
  -- keeps a bare re-run idempotent (it never creates a version=3).
  insert into public.psi_agt002_company_evidence_registry (
    entry_id, version, current, document_class, classification, estado_integracion, sensibilidad,
    source_reference, item_id, duplicate_count, hash, hash_contrastado_corpus_index, zona_almacenamiento,
    utilidad_decisional, accion_humana, human_gate, control_de_uso, allowed_use, metadata_only,
    vigente_para_habilitacion, existence_status, human_review_status, applicability_status,
    vigencia_text, expiry, decision_humana, decision_humana_fecha, estado_posterior_decision,
    rollback_can_deactivate, rollback_scope, integration_active, notes, source_manifest_version
  )
  select
    v1.entry_id, 2, true, v1.document_class, v1.classification, v1.estado_integracion, v1.sensibilidad,
    v1.source_reference, v1.item_id, v1.duplicate_count,
    case when ov.entry_id is not null then ov.hash else v1.hash end,
    case when ov.entry_id is not null then ov.hash_contrastado else v1.hash_contrastado_corpus_index end,
    v1.zona_almacenamiento, v1.utilidad_decisional, v1.accion_humana, v1.human_gate, v1.control_de_uso,
    v1.allowed_use, v1.metadata_only, v1.vigente_para_habilitacion,
    case when ov.entry_id is not null then ov.existence_status else v1.existence_status end,
    'pending_human_review', 'pending_case_validation',
    case when ov.entry_id is not null then ov.vigencia_text else v1.vigencia_text end,
    case when ov.entry_id is not null and ov.override_expiry then ov.expiry else v1.expiry end,
    null, null, null,
    v1.rollback_can_deactivate, v1.rollback_scope, v1.integration_active,
    case when ov.entry_id is not null then ov.notes else v1.notes end,
    'v0.3.1-approved-20260829'
  from public.psi_agt002_company_evidence_registry v1
  left join (
    values
      -- communications_license: v0.2's classifier could not determine the composite
      -- of the licence; v0.3.1 identifies it as five (5) TIC permits/acts, records a
      -- hash contrasted against the corpus index, and states the remaining gates
      -- (firmeza, titularidad, territorio) without asserting they are satisfied.
      (
        'communications_license'::text, 'reported'::text,
        '8e1f0b37b48d1de7128e2b7f4b29a29ac308f6baceb5c555b9554ce5d9881ace'::text, true::boolean,
        'Compuesto de cinco (5) permisos/actos TIC; vigencia no determinable de forma unificada del corpus sanitizado; documento de 63 páginas.'::text,
        false::boolean, null::date,
        'v0.3.1: la licencia de comunicaciones corresponde a un compuesto de cinco (5) permisos/actos TIC (no a un único acto); hash_contrastado_corpus_index=true confirma el archivo contra el índice del corpus v0.3.1, pero antes de dar por cumplidos los gates de firmeza del acto administrativo, titularidad de la persona jurídica y territorio/cobertura autorizados, este registro no afirma por sí solo que el compuesto acredite la habilitación. Persiste la corrección de taxonomía señalada en v0.2 (el clasificador la marcó erróneamente como personal).'::text
      ),
      -- financial_and_tax_pack: still not_verified/no hash — the pack observed in the
      -- corpus is incomplete and a lone corporate_tax_return is not equivalent to it.
      (
        'financial_and_tax_pack'::text, 'not_verified'::text, null::text, false::boolean,
        'Corte 2025; actualización anual y según pliego; pack incompleto en v0.3.1, pendiente de consolidación.'::text,
        false::boolean, null::date,
        'v0.3.1: existence_status=not_verified — el pack financiero está incompleto en el corpus revisado; la declaración de renta corporativa (corporate_tax_return) observada de forma aislada no equivale al pack financiero y de renta completo (estados financieros, declaración de renta, certificaciones y anexos). Contiene además soportes personales de profesionales contables y un anexo específico del proceso, señalados ya en v0.2.'::text
      ),
      -- overtime_authorization: still not_verified/no hash — no MinTrabajo authorization
      -- was found; the v0.2 hash is deliberately not reaffirmed as v0.3.1 evidence.
      (
        'overtime_authorization'::text, 'not_verified'::text, null::text, false::boolean,
        'Vigencia no confirmada; en v0.3.1 no se localizó autorización vigente del Ministerio del Trabajo.'::text,
        false::boolean, null::date,
        'v0.3.1: existence_status=not_verified — no se encontró en el corpus revisado una autorización de horas extra emitida por el Ministerio del Trabajo; el hash registrado en v0.2 para este archivo no se reafirma como evidencia en v0.3.1 (hash=null en esta versión). No inferir habilitación laboral sólo por el nombre del archivo.'::text
      ),
      -- corporate_background_checks: three dated queries (2026-06-01), an observed
      -- 89-day window up to the 2026-08-29 expiry recorded here, without asserting
      -- contractual currency for any specific case.
      (
        'corporate_background_checks'::text, 'reported'::text,
        '5cf1e715b51d18dc6a4643308447f7c238c0c73471c8eb81598f39da7dcf90bf'::text, true::boolean,
        'Tres (3) consultas fechadas 2026-06-01; ventana observada de 89 días hasta 2026-08-29 (expiry registrado); no constituye vigencia contractual.'::text,
        true::boolean, '2026-08-29'::date,
        'v0.3.1: hash_contrastado_corpus_index=true confirma el archivo contra el índice del corpus; se registran tres (3) consultas de antecedentes con fecha 2026-06-01 y una ventana observada de 89 días hasta el expiry 2026-08-29; este registro documenta la ventana observada, sin afirmar vigencia contractual para un caso específico. No mezclar con antecedentes del representante legal.'::text
      )
  ) as ov(entry_id, existence_status, hash, hash_contrastado, vigencia_text, override_expiry, expiry, notes)
    on ov.entry_id = v1.entry_id
  where v1.version = 1
    and v1.source_manifest_version = 'v0.2-provisional-20260801'
    and v1.entry_id = any(v_entry_ids)
  on conflict (entry_id, version) do nothing;

  -- Reapply safety: 075's rollback deactivates v0.3.1 rows without ever deleting
  -- them, so after a rollback the INSERT above is a no-op via ON CONFLICT DO NOTHING.
  -- Promote any already-existing, now-inactive v0.3.1 row back to current here, so
  -- rollback -> reapply converges to the same state as a fresh apply.
  update public.psi_agt002_company_evidence_registry
  set current = true
  where current = false
    and version = 2
    and source_manifest_version = 'v0.3.1-approved-20260829'
    and entry_id = any(v_entry_ids);

  select count(*) into v_current_v031_count
  from public.psi_agt002_company_evidence_registry
  where current and source_manifest_version = 'v0.3.1-approved-20260829';

  if v_current_v031_count <> 17 then
    raise exception 'psi_agt002_company_evidence_registry: expected exactly 17 current v0.3.1-approved-20260829 rows after migration 075, found %.', v_current_v031_count;
  end if;
end $$;

commit;
