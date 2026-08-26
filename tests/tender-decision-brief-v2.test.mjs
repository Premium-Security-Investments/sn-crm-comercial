import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const modelPath = new URL('../src/tenders/tenderDecisionBriefModel.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [modelPath], bundle: true, platform: 'node', format: 'esm', write: false });
const modelUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const {
  tenderBriefClassificationAvailable,
  tenderBriefUnavailableCopy,
  tenderCommercialPotential,
  tenderBriefHeadline,
  resolveFindingEvidence,
} = await import(modelUrl);

const blockers = [{ key: 'blocker-1', title: 'Domicilio exigido en Manizales', state: 'Pendiente de validación' }];
const conditions = [
  { key: 'condition-1', title: 'Certificación de experiencia específica', state: 'Pendiente de validación' },
  { key: 'condition-2', title: 'Licencia vigente', state: 'Validación registrada' },
];

testAbsence();
testCommercialPotential();
testCompactHeadline();
testEvidenceOutsideBrief();
testTask5Surfaces();
console.log('tender decision brief Task 5 model and surface checks passed');

function testAbsence() {
  assert.equal(tenderBriefClassificationAvailable(null), false);
  assert.equal(tenderBriefClassificationAvailable(undefined), false);
  const copy = tenderBriefUnavailableCopy();
  assert.match(copy.title, /Clasificación ejecutiva no disponible/);
  assert.match(copy.impedimentNote, /No hay clasificación ejecutiva de impedimentos/);
  assert.doesNotMatch(copy.body, /no se identificaron impedimentos/i);
}

function testCommercialPotential() {
  const potential = tenderCommercialPotential({
    amountLabel: '$1.000',
    commercialFitPositives: ['Encaje con vigilancia'],
  });
  assert.equal(potential.classified, true);
  assert.deepEqual(potential.reasons, ['Encaje con vigilancia']);
  assert.deepEqual(potential.contextFacts, ['Cuantía: $1.000']);
  assert.equal(tenderCommercialPotential({ amountLabel: '$1.000' }).classified, false);
}

function testCompactHeadline() {
  const potential = tenderCommercialPotential({ commercialFitPositives: ['Encaje con vigilancia'] });
  const headline = tenderBriefHeadline({ blockers, conditions, potential });
  assert.match(headline, /Hay 1 impedimento confirmado/);
  assert.match(headline, /Hay 2 condiciones pendientes/);
  assert.match(headline, /Encaje con vigilancia/);
  assert.ok((headline.match(/[.!?](?:\s|$)/g) || []).length <= 3, 'la introducción queda limitada a tres frases');
  assert.doesNotMatch(headline, /rationale|capacidad|trámites/i);
}

function testEvidenceOutsideBrief() {
  const finding = {
    id: 'exercise::territorialidad',
    label: 'Agencia Manizales',
    rationale: 'interno',
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

function testTask5Surfaces() {
  const brief = readFileSync(new URL('../src/tenders/components/TenderDecisionBrief.tsx', import.meta.url), 'utf8');
  const evidence = readFileSync(new URL('../src/tenders/components/TenderFindingEvidence.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
  const summary = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionSummary.tsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const experience = readFileSync(new URL('../src/tenders/components/TenderDecisionExperience.tsx', import.meta.url), 'utf8');

  assert.match(brief, /tenderDecisionBlockers\(review, questionResponses\)/);
  assert.match(brief, /tenderDecisionConditions\(review, questionResponses\)/);
  assert.doesNotMatch(brief, /TenderFindingEvidence|TenderIntegralAnalysisV3View|tenderDecisionSupportedAspects|tenderDecisionPreparationActions/);
  assert.doesNotMatch(brief, /\.rationale/);
  assert.match(brief, /Revisar \{pendingConditions\.length\} condiciones pendientes/);
  assert.match(brief, /Registrar decisión humana/);
  assert.doesNotMatch(brief, /Registrar GO|Registrar NO GO|tender-decision-register-(go|nogo)|open\(['"](?:go|no_go)/);
  assert.match(evidence, /resolveFindingEvidence/);

  assert.match(main, /<TenderDecisionExperience/);
  const briefIndex = experience.indexOf('<TenderDecisionBrief');
  const panelIndex = experience.indexOf('<TenderGoNoGoDecisionPanel');
  assert.ok(briefIndex >= 0 && panelIndex > briefIndex, 'el panel queda inmediatamente debajo del brief dentro de Decisión');
  const briefTagEnd = experience.indexOf('/>', briefIndex) + 2;
  assert.ok(experience.slice(briefTagEnd, panelIndex).indexOf('Tender') === -1, 'no se inserta otra superficie entre brief y panel en fallback');

  assert.match(panel, /<TenderGoNoGoDecisionSummary loading=\{loading\} current=\{current\} \/>/);
  assert.match(summary, /loading: boolean/);
  assert.match(summary, /current: TenderGoNoGoDecision \| null/);
  assert.match(summary, /Decisión humana vigente/);
}
