import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

// AGT-002 · regresión de UI (AGT-002-002).
//
// Síntoma reportado en producción: dos expedientes distintos (17 documentos vs 13 documentos, es
// decir dos corridas y dos payloads V3 distintos) mostraban EXACTAMENTE la misma pantalla — la
// pausa genérica «Análisis integral pausado» afuera y, al abrir «Ver respaldo técnico del
// análisis», la misma pausa genérica «Cobertura integral no disponible» adentro. El respaldo
// técnico repetía el early-return del gate de cobertura en lugar de mostrar el análisis realmente
// conservado de ESE expediente, así que la trazabilidad era indistinguible entre licitaciones.
//
// Contrato fijado aquí:
//   1. La superficie de decisión (TenderAnalysisSection) NO se relaja: sigue fail-closed y pausada
//      mientras `tenderAnalysisCoverageReady` sea false. Ninguna condición, impedimento, unidad ni
//      cifra de cobertura integral puede filtrarse ahí.
//   2. El respaldo técnico (TenderIntegralAnalysisV3View) deja de repetir la pausa: cuando existe
//      un payload integral rinde ese payload —el del expediente exacto— rotulado como respaldo
//      técnico histórico, solo trazabilidad.
//   3. Ese modo se rotula en español y declara explícitamente que NO es una recomendación integral
//      vigente; nunca insinúa GO ni disposición para la decisión.
//   4. Con cobertura lista, el comportamiento completo previo se conserva intacto.
//   5. El contenedor exterior <details>/<summary> es una tarjeta compacta, accesible y cerrada por
//      defecto, con chevron propio y estados hover/focus/open, sin marcador nativo.
//
// Pruebas conductuales sobre el HTML realmente renderizado (renderToStaticMarkup) y sobre el
// contrato estructural/CSS. Sin red, sin base de datos, sin commit/push/deploy.

const root = new URL('../', import.meta.url);

const TenderAnalysisSection = await loadReactComponent(
  'src/tenders/components/TenderAnalysisSection.tsx',
  'TenderAnalysisSection',
);
const TenderIntegralAnalysisV3View = await loadReactComponent(
  'src/tenders/components/TenderIntegralAnalysisV3View.tsx',
  'TenderIntegralAnalysisV3View',
);

const mainSource = readFileSync(new URL('src/main.tsx', root), 'utf8');
const styles = readFileSync(new URL('src/styles.css', root), 'utf8');
const technicalViewSource = readFileSync(new URL('src/tenders/components/TenderIntegralAnalysisV3View.tsx', root), 'utf8');
const analysisSectionSource = readFileSync(new URL('src/tenders/components/TenderAnalysisSection.tsx', root), 'utf8');

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------
// Fixtures: DOS expedientes distintos. Todo texto derivado lleva el prefijo del expediente, así
// que cualquier fuga de un expediente al otro es detectable por substring, no por conteo.
// Los tamaños (17 y 13 unidades) reproducen los dos expedientes del reporte.
// ---------------------------------------------------------------------------------------------
const CATEGORIES = ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic'];

function integralUnit(tag, index) {
  const n = index + 1;
  return {
    unit_id: `${tag}-unit-${n}`,
    unit_kind: 'tender_requirement',
    requirement_id: `${tag}-req-${n}`,
    category: CATEGORIES[index % CATEGORIES.length],
    sequence: n,
    title: `${tag} · Requisito gobernado ${n}`,
    assessment_mode: 'assessed',
    conclusion: { status: 'gap_evidenced', summary: `${tag} · conclusión ${n}: la evidencia aportada no cubre el requisito.`, confidence: 'medium' },
    blocking: { effect: 'non_blocking', curability: 'curable', reason: `${tag} · sin efecto bloqueante ${n}.` },
    evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
    evidence_refs: [{ ref: `evidence:chunk:${tag}:${n}`, source_type: 'tender_document', purpose: 'requirement_basis' }],
    missing_evidence: [{ missing_id: `${tag}-missing-${n}`, evidence_class_id: null, needed_source_type: 'company_evidence', reason: `${tag} · falta el certificado ${n}.`, critical: true }],
    commercial_impact: { level: 'high', summary: `${tag} · impacto comercial ${n}.`, dimension: 'schedule' },
    legal_assessment: { status: 'not_verified', basis_refs: [], summary: `${tag} · sin verificación legal ${n}.`, human_legal_review_required: false },
    actions: [{ summary: `${tag} · acción ${n}: solicitar el soporte al área responsable.` }],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: `${tag} · sin hito ${n}.` },
    escalation: { required: false, level: 'none', reason: `${tag} · sin escalamiento ${n}.` },
    closure: { status: 'human_confirmation_required', condition: `${tag} · condición de cierre ${n}.`, evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: `${tag} · validación humana pendiente ${n}.` },
  };
}

function governedFinding(tag, kind) {
  return {
    id: `agt002::${tag}::${kind}::gobernada`,
    requirement_id: `${tag}-req-1`,
    label: `ETIQUETA-INTERNA-${tag}`,
    reviewed_status: kind === 'blocker' ? 'blocker' : 'decision_question',
    rationale: `RATIONALE-INTERNO-${tag}-NUNCA-VISIBLE`,
    evidence_refs: [],
    presentation: {
      title: `${tag} · condición gobernada`,
      summary: `${tag} · resumen de la condición gobernada.`,
      missing: `${tag} · falta el soporte de la condición.`,
      action_required: `${tag} · registrar el soporte aquí.`,
    },
  };
}

function analysisFor(tag, unitCount) {
  const units = Array.from({ length: unitCount }, (_, index) => integralUnit(tag, index));
  return {
    run_id: `run-${tag.toLowerCase()}`,
    snapshot_id: `snap-${tag.toLowerCase()}`,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 0,
    integral_analysis: {
      contract_version: 'test@1',
      coverage: {
        manifest_version: 'test@1',
        expected_requirement_ids: units.map(unit => unit.requirement_id),
        analyzed_requirement_ids: units.map(unit => unit.requirement_id),
        material_omissions: false,
        omission_reasons: [],
        company_evidence_manifest_version: 'test@1',
        company_evidence_class_ids: [],
        legal_corpus_version_id: null,
      },
      analysis_units: units,
    },
    manifest_unresolved_entries: [
      { requirement_id: `${tag}-req-pendiente`, label: `${tag} · pendiente sin evidencia suficiente`, category: 'habilitating', origin: 'manifest', status: 'unresolved' },
    ],
    // Presente a propósito: el modo histórico debe SUPRIMIR el alcance del manifiesto (una cifra
    // de cobertura), mientras que la lectura integral vigente sí lo rinde.
    manifest_scope: {
      registry_sections: 68,
      pre_go_relevant: 15,
      proposal_sections: 10,
      atomized_entry_count: unitCount + 3,
      analyzable_requirement_ids: units.map(unit => unit.requirement_id),
      section_ledger_accounted: 15,
      proposal_ledger_accounted: 20,
      dispositions: { analyzed_candidate: unitCount, excluded_with_reason: 0, unresolved_visible: 1 },
    },
    decision_review: {
      recommendation: 'pending_human_decision',
      decision_questions: [governedFinding(tag, 'decision-question')],
      blockers: [],
      supported: [],
      preparation: [],
      not_applicable: [],
      counts: { supported: 0, preparation: 0, not_applicable: 0, decision_questions: 1, blockers: 0 },
    },
  };
}

const READY_COVERAGE = Object.freeze({
  tender_requirement_inventory: Object.freeze({
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: true,
    recommendation: 'proceed_to_analysis',
    human_review_required: true,
    expedient_coverage: { status: 'complete', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
    analyzed_coverage: { status: 'complete', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
  }),
});
// Forma real del contrato P0 vigente: inventario presente y bien formado, pero decision_ready:false.
const PAUSED_COVERAGE = Object.freeze({
  tender_requirement_inventory: Object.freeze({
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: false,
    recommendation: 'pause',
    human_review_required: true,
    expedient_coverage: { status: 'partial', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
    analyzed_coverage: { status: 'incomplete', total_source_units: 9, dispositioned_source_units: 0, requirement_count: 0 },
  }),
});

const TAG_A = 'EXPEDIENTE-ALFA';
const TAG_B = 'EXPEDIENTE-BETA';
const A_UNITS = 17;
const B_UNITS = 13;

const ANALYSIS_A = analysisFor(TAG_A, A_UNITS);
const ANALYSIS_B = analysisFor(TAG_B, B_UNITS);
const withCoverage = (analysis, coverage) => ({ ...analysis, evidence_coverage: coverage });

const PAUSED_A = withCoverage(ANALYSIS_A, PAUSED_COVERAGE);
const PAUSED_B = withCoverage(ANALYSIS_B, PAUSED_COVERAGE);
// Histórico anterior al contrato de inventario: sin cobertura en absoluto.
const NO_COVERAGE_A = withCoverage(ANALYSIS_A, undefined);
const READY_A = withCoverage(ANALYSIS_A, READY_COVERAGE);

const DOCUMENTS = [{ id: 'doc-1', name: 'pliego.pdf', size: 1024, document_type: 'pliego', current: true, uploaded_at: '2026-08-01T10:00:00.000Z' }];

const renderAnalysisSection = analysis => renderReactComponent(TenderAnalysisSection, {
  analysis,
  documents: DOCUMENTS,
  busy: false,
  canRunPreview: true,
  onAnalyzePreview: () => {},
  questionResponses: [],
  canAnswerQuestions: true,
  onSaveQuestionResponse: async () => {},
});
const renderBackup = analysis => renderReactComponent(TenderIntegralAnalysisV3View, { analysis });

const pausedBackupA = renderBackup(PAUSED_A);
const pausedBackupB = renderBackup(PAUSED_B);
const readyBackupA = renderBackup(READY_A);

// Rótulos del modo trazabilidad, en español y sin ambigüedad.
const HISTORICAL_EYEBROW = 'Respaldo técnico histórico';
const HISTORICAL_ONLY = 'solo trazabilidad';

// ---------------------------------------------------------------------------------------------
// 1 · La superficie de decisión NO se relaja: sigue fail-closed y pausada.
// ---------------------------------------------------------------------------------------------
test('la superficie primaria de decisión permanece fail-closed y pausada cuando la cobertura no está lista', () => {
  for (const [caso, analysis] of [['inventario decision_ready:false', PAUSED_A], ['sin cobertura alguna', NO_COVERAGE_A], ['otro expediente', PAUSED_B]]) {
    const html = renderAnalysisSection(analysis);
    const tag = analysis === PAUSED_B ? TAG_B : TAG_A;

    assert.ok(html.includes('Análisis integral pausado'), `Análisis debe seguir pausado (${caso})`);
    assert.ok(html.includes('No hay recomendación integral disponible'), `la pausa no puede insinuar cobertura integral (${caso})`);

    assert.equal(html.includes(`${tag} · condición gobernada`), false, `ninguna condición gobernada puede filtrarse (${caso})`);
    assert.equal(html.includes('Requisitos analizados'), false, `ningún conteo de cobertura integral puede filtrarse (${caso})`);
    assert.equal(html.includes('Condiciones pendientes de validar'), false, `la superficie de validación no puede abrirse en pausa (${caso})`);
    for (const unit of analysis.integral_analysis.analysis_units) {
      assert.equal(html.includes(unit.title), false, `ninguna unidad V3 puede filtrarse a la superficie de decisión (${caso})`);
    }
  }
});

test('el gate fail-closed de la superficie de decisión sigue siendo el selector compartido, sin excepciones locales', () => {
  assert.match(
    analysisSectionSource,
    /const coveragePaused = hasIntegralV3Payload && !tenderAnalysisCoverageReady\(analysis\?\.evidence_coverage\)/,
    'la pausa de decisión debe seguir derivándose del selector compartido sobre toda la cobertura',
  );
  assert.match(analysisSectionSource, /const hasIntegralV3 = hasIntegralV3Payload && !coveragePaused/, 'la lectura completa sigue exigiendo cobertura lista');
  assert.doesNotMatch(analysisSectionSource, /tenderRequirementInventoryReady/, 'Análisis no puede gatear por su cuenta sobre el inventario legado');
});

// ---------------------------------------------------------------------------------------------
// 2 · El respaldo técnico deja de repetir la pausa: rinde el payload del expediente exacto.
// ---------------------------------------------------------------------------------------------
test('el respaldo técnico ya no repite la pausa genérica cuando existe un payload integral', () => {
  for (const html of [pausedBackupA, pausedBackupB, renderBackup(NO_COVERAGE_A)]) {
    assert.equal(html.includes('Cobertura integral no disponible'), false, 'el respaldo técnico ya no puede repetir el aviso de pausa de la superficie de decisión');
    assert.notEqual(html, '', 'con payload integral el respaldo técnico debe rendir contenido');
  }
});

test('el respaldo técnico rinde el payload histórico del expediente exacto, cada unidad una sola vez', () => {
  for (const [html, analysis] of [[pausedBackupA, PAUSED_A], [pausedBackupB, PAUSED_B]]) {
    const units = analysis.integral_analysis.analysis_units;
    for (const unit of units) {
      assert.equal(countOf(html, `<h4>${unit.title}</h4>`), 1, `${unit.title} debe rendirse exactamente una vez`);
      assert.ok(html.includes(unit.conclusion.summary), 'la conclusión gobernada se conserva verbatim');
      assert.ok(html.includes(unit.missing_evidence[0].reason), 'la evidencia pendiente gobernada se conserva verbatim');
      assert.ok(html.includes(unit.actions[0].summary), 'la acción gobernada se conserva verbatim');
      assert.ok(html.includes(unit.unit_id), 'la trazabilidad técnica conserva el unit_id de este expediente');
    }
    for (const entry of analysis.manifest_unresolved_entries) {
      assert.ok(html.includes(entry.label), 'los pendientes del manifiesto de este expediente se conservan');
    }
    assert.ok(html.includes(analysis.run_id), 'la trazabilidad conserva la ejecución de este expediente');
    assert.ok(html.includes(analysis.snapshot_id), 'la trazabilidad conserva el snapshot de este expediente');
  }
});

test('dos expedientes distintos producen respaldos técnicos distintos: ningún rótulo se filtra de uno al otro', () => {
  assert.notEqual(A_UNITS, B_UNITS, 'los dos expedientes deben diferir en tamaño, como los dos casos reportados');
  assert.notEqual(pausedBackupA, pausedBackupB, 'dos expedientes distintos no pueden rendir el mismo HTML');

  assert.equal(pausedBackupA.includes(TAG_B), false, `ningún rótulo de ${TAG_B} puede aparecer en el respaldo de ${TAG_A}`);
  assert.equal(pausedBackupB.includes(TAG_A), false, `ningún rótulo de ${TAG_A} puede aparecer en el respaldo de ${TAG_B}`);

  const renderedUnits = html => countOf(html, '<h4>');
  assert.equal(renderedUnits(pausedBackupA), A_UNITS, 'el respaldo rinde exactamente las unidades de su propio expediente');
  assert.equal(renderedUnits(pausedBackupB), B_UNITS, 'el respaldo rinde exactamente las unidades de su propio expediente');
});

// ---------------------------------------------------------------------------------------------
// 3 · El modo está rotulado en español como respaldo histórico / solo trazabilidad y niega de
//     forma explícita ser una recomendación integral vigente. Nunca insinúa GO ni disposición.
// ---------------------------------------------------------------------------------------------
test('el modo trazabilidad se rotula explícitamente como respaldo técnico histórico y solo trazabilidad', () => {
  for (const html of [pausedBackupA, pausedBackupB]) {
    assert.ok(html.includes(HISTORICAL_EYEBROW), 'el modo debe rotularse como respaldo técnico histórico');
    assert.ok(html.includes(HISTORICAL_ONLY), 'el modo debe declararse solo trazabilidad');
    assert.match(html, /no es una recomendaci[oó]n integral vigente/i, 'debe negar explícitamente ser una recomendación integral vigente');
    assert.ok(html.includes('data-mode="historical-traceability"'), 'el modo debe ser identificable estructuralmente');
  }
});

test('el modo trazabilidad nunca insinúa GO ni disposición para la decisión', () => {
  for (const html of [pausedBackupA, pausedBackupB]) {
    assert.ok(html.includes('Validación humana pendiente'), 'la advertencia de autoridad humana sigue visible');
    assert.ok(html.includes('No decide GO / NO GO'), 'el respaldo histórico debe negar explícitamente la decisión GO / NO GO');

    assert.equal(html.includes('Análisis integral por requisito'), false, 'el modo histórico nunca se presenta como el análisis integral vigente');
    assert.equal(html.includes('Requisitos analizados'), false, 'ninguna cifra de cobertura integral puede presentarse en modo histórico');
    assert.equal(html.includes('Requisitos analizables'), false, 'ninguna cifra de alcance del manifiesto puede presentarse en modo histórico');
    assert.equal(html.includes('agt002-v3-scope'), false, 'el bloque de alcance del manifiesto no pertenece al modo histórico');
    assert.equal(html.includes('Indicadores de evidencia'), false, 'los indicadores agregados de cobertura no pertenecen al modo histórico');
  }
});

test('el modo trazabilidad no enlaza a condiciones de una superficie de decisión que está pausada', () => {
  for (const html of [pausedBackupA, pausedBackupB]) {
    assert.equal(html.includes('Ver condición principal'), false, 'sin superficie de decisión activa el enlace no tiene destino: se omite');
    assert.equal(/href="#tender-condition-\d+"/.test(html), false, 'ningún ancla de condición puede quedar colgando en modo histórico');
  }
  // El rationale y la etiqueta internos del decision_review nunca son texto visible, tampoco aquí.
  assert.equal(pausedBackupA.includes(`RATIONALE-INTERNO-${TAG_A}-NUNCA-VISIBLE`), false);
  assert.equal(pausedBackupA.includes(`ETIQUETA-INTERNA-${TAG_A}`), false);
});

// ---------------------------------------------------------------------------------------------
// 4 · Con cobertura lista, todo el comportamiento previo se conserva intacto.
// ---------------------------------------------------------------------------------------------
test('con cobertura lista el respaldo técnico conserva íntegro su comportamiento completo', () => {
  assert.ok(readyBackupA.includes('Análisis integral por requisito'), 'la lectura integral completa se conserva');
  assert.ok(readyBackupA.includes(`<dt>Requisitos analizados</dt><dd>${A_UNITS}</dd>`), 'el conteo real de cobertura se conserva');
  assert.ok(readyBackupA.includes('Indicadores de evidencia (no excluyentes)'), 'los indicadores de evidencia se conservan');
  assert.ok(readyBackupA.includes('Requisitos analizables'), 'el alcance del manifiesto se conserva con cobertura lista');
  assert.ok(readyBackupA.includes('agt002-v3-scope'), 'el bloque de alcance del manifiesto se conserva con cobertura lista');
  assert.ok(readyBackupA.includes('Validación humana pendiente'), 'la advertencia humana se conserva');
  assert.ok(readyBackupA.includes('Ver condición principal'), 'el enlace a la condición gobernada se conserva con cobertura lista');

  assert.equal(readyBackupA.includes(HISTORICAL_EYEBROW), false, 'con cobertura lista no puede rotularse como respaldo histórico');
  assert.equal(readyBackupA.includes('data-mode="historical-traceability"'), false, 'con cobertura lista no puede activarse el modo histórico');

  for (const unit of READY_A.integral_analysis.analysis_units) {
    assert.equal(countOf(readyBackupA, `<h4>${unit.title}</h4>`), 1, `${unit.title} se conserva una sola vez con cobertura lista`);
  }

  const analysisHtml = renderAnalysisSection(READY_A);
  assert.equal(analysisHtml.includes('Análisis integral pausado'), false, 'con cobertura lista la superficie de decisión no puede seguir pausada');
  assert.ok(analysisHtml.includes(`${TAG_A} · condición gobernada`), 'con cobertura lista Análisis rinde la condición gobernada');
});

test('sin payload integral el respaldo técnico sigue sin rendir nada, ni siquiera el modo histórico', () => {
  for (const analysis of [null, { run_id: 'r1' }, { integral_analysis: { analysis_units: [] } }, { evidence_coverage: PAUSED_COVERAGE }]) {
    assert.equal(renderBackup(analysis), '', 'un expediente sin análisis integral no tiene trazabilidad que conservar');
  }
});

test('el respaldo técnico sigue gateando con el mismo selector puro, antes de cualquier derivación integral', () => {
  const gate = technicalViewSource.match(/if \(!tenderAnalysisCoverageReady\(analysis\?\.evidence_coverage\)\)/);
  assert.ok(gate, 'el respaldo técnico debe seguir gateando con el selector compartido sobre toda la cobertura');
  for (const derivation of ['tenderIntegralAnalysisSummary(integral)', 'tenderIntegralPhaseGroups(integral)']) {
    assert.ok(
      technicalViewSource.indexOf(gate[0]) < technicalViewSource.indexOf(derivation),
      `el gate de cobertura debe anteceder a ${derivation}`,
    );
  }
  assert.ok(
    technicalViewSource.indexOf('if (!integral || !units || units.length === 0) return null;') < technicalViewSource.indexOf(gate[0]),
    'el consumo opcional se evalúa antes que el gate: sin payload no se rinde nada',
  );
  assert.doesNotMatch(technicalViewSource, /tenderRequirementInventoryReady/, 'el respaldo técnico no puede gatear sobre el inventario legado por su cuenta');
});

// ---------------------------------------------------------------------------------------------
// 5 · El montaje exterior duplicado y su CSS quedan eliminados de la experiencia de la persona.
//     La vista histórica aislada conserva sus helpers internos para consumidores no frontales.
// ---------------------------------------------------------------------------------------------
test('main y styles no conservan el montaje ni el CSS obsoleto del respaldo técnico exterior', () => {
  assert.doesNotMatch(mainSource, /tender-technical-analysis|TenderIntegralAnalysisV3View|Ver respaldo técnico del análisis/);
  assert.doesNotMatch(styles, /tender-integral-analysis-trace|Ver respaldo técnico del análisis/);
});
