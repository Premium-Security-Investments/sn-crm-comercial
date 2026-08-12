begin;

-- Remove only the exact six curation rows introduced by migration 066. This does not
-- alter analysis history, GO/NO-GO state, documents, or company evidence.
delete from public.psi_agt002_integral_governance_overrides
where opportunity_id = '54190e51-15fb-46af-b0aa-8f13461a3110'::uuid
  and curated_by = '60b26173-1226-476b-a958-cf2917661432'::uuid
  and version = 3
  and current = true
  and (requirement_id, override_kind) in (
    ('financial-working-capital', 'category_override'),
    ('legal-rce-policy', 'category_override'),
    ('legal-collective-life-policy', 'category_override'),
    ('financial-working-capital', 'evidence_class_link'),
    ('legal-rce-policy', 'evidence_class_link'),
    ('legal-collective-life-policy', 'evidence_class_link')
  );

commit;
