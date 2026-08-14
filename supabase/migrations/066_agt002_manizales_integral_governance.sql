begin;

-- Human-approved governance curation for Rama Judicial Manizales SA-24-2026.
-- Approval source: Juan Botero's explicit authorization in the 2026-08-12 AGT-002
-- production activation session. This approves only the six traceable governance
-- bindings below; it is NOT a GO/NO-GO decision and authorizes no signature, send,
-- submission, award representation, or autonomous external action.
--
-- Fail-closed/idempotent release behavior:
--   * zero rows for this opportunity -> insert the exact reviewed set;
--   * exact six-row state already present -> no-op;
--   * any partial/different state -> abort instead of overwriting human governance.
do $agt002_manizales_governance$
declare
  v_existing integer;
  v_matching integer;
begin
  select count(*)::integer into v_existing
  from public.psi_agt002_integral_governance_overrides
  where opportunity_id = '54190e51-15fb-46af-b0aa-8f13461a3110'::uuid;

  with approved(requirement_id, override_kind, category_value, evidence_class_id, rationale, source_reference) as (
    values
    ('financial-working-capital', 'category_override', 'habilitating', null, 'El pliego evalúa el índice de Capital de Trabajo dentro de "2.2 CAPACIDAD FINANCIERA", subsección explícita del Capítulo II "REQUISITOS HABILITANTES".', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II §2.2, secciones 408-410.'),
    ('legal-rce-policy', 'category_override', 'habilitating', null, 'HR-003 (docs/governance/2026-08-11-agt002-rama-judicial-human-review.md): la póliza de responsabilidad civil extracontractual (ítem 17) está numerada dentro del Capítulo II "REQUISITOS HABILITANTES" del pliego. Extraída ahora por contexto real (frase "responsabilidad civil extracontractual"), no por el patrón genérico "polizas?" usado hasta la versión 2 de este borrador.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 350-355.'),
    ('legal-collective-life-policy', 'category_override', 'habilitating', null, 'HR-003: la póliza de seguro de vida colectivo (ítem 18) está numerada dentro del Capítulo II "REQUISITOS HABILITANTES" del pliego. Extraída ahora por contexto real (frase "vida colectiv[oa]"), no por el patrón genérico "polizas?" usado hasta la versión 2 de este borrador.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 356-360.'),
    ('financial-working-capital', 'evidence_class_link', null, 'rup', 'El pliego basa expresamente la evaluación de los requisitos financieros en el Registro Único de Proponentes.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), sección 409.'),
    ('legal-rce-policy', 'evidence_class_link', null, 'rce_policy', 'HR-003: enlace directo, sin ambigüedad, entre el requisito ya subdividido por contexto real y la clase cerrada de póliza de responsabilidad civil extracontractual del catálogo de 17 clases empresariales.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 350-355.'),
    ('legal-collective-life-policy', 'evidence_class_link', null, 'collective_life_policy', 'HR-003: enlace directo, sin ambigüedad, entre el requisito ya subdividido por contexto real y la clase cerrada de póliza de seguro de vida colectivo del catálogo de 17 clases empresariales.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 356-360.')
  )
  select count(*)::integer into v_matching
  from public.psi_agt002_integral_governance_overrides g
  join approved a
    on a.requirement_id = g.requirement_id
   and a.override_kind = g.override_kind
   and a.category_value is not distinct from g.category_value
   and a.evidence_class_id is not distinct from g.evidence_class_id
   and a.rationale = g.rationale
   and a.source_reference = g.source_reference
  where g.opportunity_id = '54190e51-15fb-46af-b0aa-8f13461a3110'::uuid
    and g.curated_by = '60b26173-1226-476b-a958-cf2917661432'::uuid
    and g.version = 3
    and g.current = true;

  if v_existing = 6 and v_matching = 6 then
    return;
  end if;
  if v_existing <> 0 then
    raise exception 'AGT002_MANIZALES_GOVERNANCE_DRIFT: expected zero rows or the exact approved six-row set; found % rows with % exact matches', v_existing, v_matching;
  end if;

  insert into public.psi_agt002_integral_governance_overrides (
    opportunity_id, requirement_id, override_kind, category_value, evidence_class_id,
    rationale, source_reference, curated_by, curated_at, current, version
  )
  select
    '54190e51-15fb-46af-b0aa-8f13461a3110'::uuid, a.requirement_id, a.override_kind, a.category_value, a.evidence_class_id,
    a.rationale, a.source_reference, '60b26173-1226-476b-a958-cf2917661432'::uuid, '2026-08-12T17:02:21Z'::timestamptz, true, 3
  from (values
    ('financial-working-capital', 'category_override', 'habilitating', null, 'El pliego evalúa el índice de Capital de Trabajo dentro de "2.2 CAPACIDAD FINANCIERA", subsección explícita del Capítulo II "REQUISITOS HABILITANTES".', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II §2.2, secciones 408-410.'),
    ('legal-rce-policy', 'category_override', 'habilitating', null, 'HR-003 (docs/governance/2026-08-11-agt002-rama-judicial-human-review.md): la póliza de responsabilidad civil extracontractual (ítem 17) está numerada dentro del Capítulo II "REQUISITOS HABILITANTES" del pliego. Extraída ahora por contexto real (frase "responsabilidad civil extracontractual"), no por el patrón genérico "polizas?" usado hasta la versión 2 de este borrador.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 350-355.'),
    ('legal-collective-life-policy', 'category_override', 'habilitating', null, 'HR-003: la póliza de seguro de vida colectivo (ítem 18) está numerada dentro del Capítulo II "REQUISITOS HABILITANTES" del pliego. Extraída ahora por contexto real (frase "vida colectiv[oa]"), no por el patrón genérico "polizas?" usado hasta la versión 2 de este borrador.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 356-360.'),
    ('financial-working-capital', 'evidence_class_link', null, 'rup', 'El pliego basa expresamente la evaluación de los requisitos financieros en el Registro Único de Proponentes.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), sección 409.'),
    ('legal-rce-policy', 'evidence_class_link', null, 'rce_policy', 'HR-003: enlace directo, sin ambigüedad, entre el requisito ya subdividido por contexto real y la clase cerrada de póliza de responsabilidad civil extracontractual del catálogo de 17 clases empresariales.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 350-355.'),
    ('legal-collective-life-policy', 'evidence_class_link', null, 'collective_life_policy', 'HR-003: enlace directo, sin ambigüedad, entre el requisito ya subdividido por contexto real y la clase cerrada de póliza de seguro de vida colectivo del catálogo de 17 clases empresariales.', 'Pliego de Condiciones Definitivo SA-24-2026 (db9752a1-e9ee-49af-b321-883d0c23cf0a), Capítulo II, secciones 356-360.')
  ) as a(requirement_id, override_kind, category_value, evidence_class_id, rationale, source_reference);
end
$agt002_manizales_governance$;

commit;
