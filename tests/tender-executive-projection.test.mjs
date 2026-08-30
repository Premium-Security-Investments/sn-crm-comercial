import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const gatePath = new URL('../src/tenders/tenderDecisionGate.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [gatePath], bundle: true, platform: 'node', format: 'esm', write: false });
const gateUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { tenderExecutiveProjectionAvailable, tenderExecutiveRecommendation, tenderExecutiveOpenIssueCount, tenderRecommendationKind, tenderRecommendationLabel } = await import(gateUrl);

const canonical = {
  run_id: 'agt002-manizales-run-20260815', snapshot_id: 'snapshot', producer: 'AGT-002', method: 'agent_ai', status: 'completed', current: true,
  recommendation: 'pause', critical_open_count: 20,
  decision_review: {
    recommendation: 'advance_conditionally',
    counts: { supported: 9, preparation: 3, not_applicable: 13, decision_questions: 2, blockers: 0 },
    decision_questions: [{ id: 'q1' }, { id: 'q2' }], blockers: [], supported: [], preparation: [], not_applicable: [],
  },
};
assert.equal(tenderExecutiveRecommendation(canonical), 'advance_conditionally', 'Executive recommendation must use the governed decision review, not canonical pause.');
assert.equal(tenderRecommendationLabel(tenderExecutiveRecommendation(canonical)), 'Avanzar de forma condicionada');
assert.equal(tenderRecommendationKind('advance'), 'advance');
assert.equal(tenderRecommendationLabel('advance'), 'Avanzar el flujo de evidencia');
assert.equal(tenderRecommendationLabel('do_not_advance'), 'No avanzar el flujo de evidencia');
assert.doesNotMatch(tenderRecommendationLabel('advance'), /GO recomendado|participar/i);
assert.doesNotMatch(tenderRecommendationLabel('do_not_advance'), /NO GO recomendado|participar/i);
assert.equal(tenderExecutiveOpenIssueCount(canonical), 2, 'Executive open issues must be 2 material questions, not 20 technical questions.');
const fallback = { ...canonical, decision_review: null };
assert.equal(tenderExecutiveRecommendation(fallback), 'pause');
assert.equal(tenderExecutiveOpenIssueCount(fallback), 20);
const unclassifiedV3 = { ...fallback, integral_analysis: { analysis_units: [{ unit_id: 'technical-1' }] } };
assert.equal(tenderExecutiveProjectionAvailable(unclassifiedV3), false);
assert.equal(tenderExecutiveOpenIssueCount(unclassifiedV3), 20, 'A real canonical critical_open_count must remain visible even without axis projection.');
const openUnitsFallback = {
  ...fallback,
  critical_open_count: 0,
  integral_analysis: { analysis_units: [
    { unit_id: 'u1', closure: { status: 'open' } },
    { unit_id: 'u2', closure: { status: 'human_confirmation_required' } },
    { unit_id: 'u3', closure: { status: 'evidence_satisfied' } },
  ] },
};
assert.equal(tenderExecutiveOpenIssueCount(openUnitsFallback), 2, 'Missing canonical count falls back safely to open V3 units.');
assert.equal(tenderExecutiveOpenIssueCount({ ...openUnitsFallback, decision_review: { counts: { blockers: 0, decision_questions: 0 } } }), 0, 'decision_review has strict precedence, including authoritative zero.');

const analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const decisionBrief = readFileSync(new URL('../src/tenders/components/TenderDecisionBrief.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(main, /<TenderDecisionExperience[\s\S]*analysis=\{tenderAnalysis\}/);
assert.match(decisionBrief, /Brief de decisión/);
assert.match(analysisSection, /alertas materiales/i);
assert.match(analysisSection, /Clasificación ejecutiva no disponible/);
assert.match(analysisSection, /hallazgos técnicos[\s\S]*no se presentan como alertas materiales/i);
assert.doesNotMatch(analysisSection, /ManizalesDecisionReviewPanel/);
assert.doesNotMatch(analysisSection, /Decisiones y aclaraciones de la encargada/);

const goPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
assert.match(goPanel, /tenderExecutiveRecommendation\(analysis\)/);
assert.match(goPanel, /tenderExecutiveOpenIssueCount\(analysis\)/);
assert.doesNotMatch(goPanel, /analysis\.critical_open_count/);

const executiveIndex = main.indexOf('<TenderAnalysisSection');
assert.ok(executiveIndex > -1, 'Executive analysis controls remain mounted.');
assert.doesNotMatch(main, /TenderIntegralAnalysisV3View|Ver respaldo técnico del análisis/, 'The duplicate technical projection must not be mounted in main.');

console.log('tender executive projection and hierarchy checks passed');
