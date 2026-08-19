import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const modelPath = new URL('../src/tenders/tenderDecisionBriefModel.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [modelPath], bundle: true, platform: 'node', format: 'esm', write: false });
const modelUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const {
  TENDER_BRIEF_PRIORITY_LIMIT,
  tenderBriefClassificationAvailable,
  tenderBriefUnavailableCopy,
  tenderCommercialPotential,
  tenderBriefEffortSummary,
  tenderBriefPriorityItems,
  resolveFindingEvidence,
} = await import(modelUrl);

const emptyReview = {
  blockers: [],
  decision_questions: [],
  supported: [{ id: 's1', label: 'RUP', rationale: 'capacidad', evidence_refs: [] }],
  preparation: Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, label: `Prep ${index}`, rationale: 'preparable', evidence_refs: [] })),
  review_findings: [],
};

testAbsence();
testIndependence();
testPrioritization();
testLimit();
testEvidence();
testSurfaces();
console.log('tender decision brief v2 model and surface checks passed');

function testAbsence() {
  assert.equal(tenderBriefClassificationAvailable(null), false);
  assert.equal(tenderBriefClassificationAvailable(undefined), false);
  const copy = tenderBriefUnavailableCopy();
  assert.match(copy.title, /Clasificación ejecutiva no disponible/);
  assert.match(copy.impedimentNote, /No hay clasificación ejecutiva de impedimentos/);
  assert.doesNotMatch(copy.body, /no se identificaron impedimentos/i);
  assert.doesNotMatch(copy.impedimentNote, /no se encontraron impedimentos/i);
}

function testIndependence() {
  const context = { amountLabel: '$1.000', commercialFitPositives: ['Encaje con vigilancia'] };
  const attractiveWithBlocker = tenderCommercialPotential(context, {
    ...emptyReview,
    blockers: [{ id: 'b1', label: 'Impedimento', rationale: 'grave', evidence_refs: [], curability: 'curable' }],
    decision_questions: [{ id: 'q1', label: 'Validar sede', rationale: 'pendiente', evidence_refs: [] }],
  });
  const attractiveWithoutBlocker = tenderCommercialPotential(context, emptyReview);
  assert.deepEqual(attractiveWithBlocker, attractiveWithoutBlocker, 'El potencial no puede cambiar porque haya bloqueadores o condiciones pendientes.');
  assert.equal(attractiveWithBlocker.classified, true);
  assert.deepEqual(attractiveWithBlocker.reasons, ['Encaje con vigilancia']);
  const withoutCommercial = tenderCommercialPotential({ amountLabel: '$1.000' }, emptyReview);
  assert.equal(withoutCommercial.classified, false);
  assert.match(withoutCommercial.note, /Sin razones comerciales priorizadas/);
  assert.doesNotMatch(JSON.stringify(withoutCommercial), /supported|RUP/);
}

function testPrioritization() {
  const items = tenderBriefPriorityItems(emptyReview, { commercialFitPositives: ['Margen viable'] });
  const kinds = items.visible.map(item => item.kind);
  assert.ok(!items.visible.some(item => item.kind === 'potential' && /RUP/.test(item.body)), 'supported no puede entrar como razón comercial.');
  assert.ok(kinds.includes('potential'));
  assert.ok(kinds.includes('effort'));
  const effort = tenderBriefEffortSummary(emptyReview.preparation);
  assert.equal(effort.count, 9);
  assert.match(effort.headline, /trámites preparables/);
  assert.doesNotMatch(effort.headline, /9 acciones/);
}

function testLimit() {
  const review = {
    ...emptyReview,
    blockers: Array.from({ length: 8 }, (_, index) => ({ id: `b${index}`, label: `Bloqueo ${index}`, rationale: 'impedimento', evidence_refs: [] })),
    decision_questions: [{ id: 'q1', label: 'Condición', rationale: 'validar', evidence_refs: [] }],
  };
  const items = tenderBriefPriorityItems(review, {});
  assert.equal(items.visible.length, TENDER_BRIEF_PRIORITY_LIMIT);
  assert.ok(items.overflow.length > 0);
  assert.ok(items.visible.some(item => item.kind === 'potential'));
  assert.ok(items.visible.some(item => item.kind === 'effort'));
  assert.ok(items.visible[0].kind === 'impediment');
  assert.ok(items.overflow.every(item => item.kind === 'impediment' || item.kind === 'condition'));
}

function testEvidence() {
  const finding = {
    id: 'exercise::territorialidad',
    label: 'Agencia Manizales',
    rationale: 'no_probada',
    evidence_refs: [
      { type: 'registry_citation', item_ref: '2.1', sub_item_id: 'SA-24-2026#2.1#i11', char_start: 10 },
      { type: 'review_finding', finding_id: 'review::agency-manizales-current-status' },
    ],
  };
  const evidence = resolveFindingEvidence(finding, [{
    id: 'review::agency-manizales-current-status',
    disposition: 'requires_verification',
    source_id: 'src',
    locator: '§5 VM-1 — Territorialidad Manizales',
    summary: 'Presencia operativa sin acto territorial.',
  }]);
  assert.equal(evidence.length, 2);
  assert.match(evidence[0].title, /Cláusula/);
  assert.match(evidence[1].locator, /Territorialidad Manizales/);
}

function testSurfaces() {
  const analysis = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
  const brief = readFileSync(new URL('../src/tenders/components/TenderDecisionBrief.tsx', import.meta.url), 'utf8');
  const evidence = readFileSync(new URL('../src/tenders/components/TenderFindingEvidence.tsx', import.meta.url), 'utf8');
  const goPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../src/tenders/tenderDecisionGate.ts', import.meta.url), 'utf8');
  const surfaces = [analysis, brief, goPanel, gate].join('\n');

  assert.match(main, /<TenderDecisionBrief analysis=\{tenderAnalysis\}/);
  const briefIndex = main.indexOf('<TenderDecisionBrief');
  const goIndex = main.indexOf('<TenderGoNoGoDecisionPanel');
  assert.ok(briefIndex >= 0 && goIndex > briefIndex, 'El brief debe preceder visualmente el control formal GO/NO GO.');

  assert.match(analysis, /Condiciones pendientes de validar/);
  assert.match(analysis, /Aquí sólo se responden las alertas materiales/);
  assert.match(analysis, /Clasificación ejecutiva no disponible/);
  assert.match(analysis, /TenderFindingEvidence/);
  assert.doesNotMatch(analysis, /Impedimento confirmado/);
  assert.doesNotMatch(analysis, /Esfuerzo comercial inmediato/);
  assert.doesNotMatch(analysis, /Por qué vale la pena considerarla/);
  assert.doesNotMatch(analysis, /<TenderDecisionBrief/);
  assert.doesNotMatch(analysis, /review\.blockers\.map|decision_review\.blockers\.map/);
  assert.doesNotMatch(analysis, /review\.supported\.map|decision_review\.supported/);
  assert.doesNotMatch(analysis, /review\.preparation\.map|decision_review\.preparation/);

  assert.match(brief, /Validar primero/);
  assert.match(brief, /TenderFindingEvidence/);
  assert.doesNotMatch(brief, /QuestionResponseCard/);
  assert.doesNotMatch(brief, /GO recomendado|NO GO recomendado/);
  assert.doesNotMatch(brief, /compromete la viabilidad de participar/);
  assert.match(brief, /no dice participar ni no participar/);
  assert.match(brief, /Evidencia de capacidad revisada/);
  assert.match(brief, /Trámites preparables/);
  assert.match(evidence, /Ver evidencia/);

  assert.doesNotMatch(goPanel, /decisionReview\.supported|decision_review\.supported/);
  assert.doesNotMatch(goPanel, /decision_review\.preparation\.map/);
  assert.doesNotMatch(goPanel, /Por qué vale la pena/);
  assert.match(goPanel, /brief de decisión precede este control/i);

  assert.doesNotMatch(gate, /'GO recomendado'|'NO GO recomendado'/);
  assert.match(gate, /Avanzar el flujo de evidencia/);
  assert.doesNotMatch(surfaces, /GO recomendado|NO GO recomendado/);
}
