import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const gatePath = new URL('../src/tenders/tenderDecisionGate.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [gatePath], bundle: true, platform: 'node', format: 'esm', write: false });
const gateUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { tenderExecutiveProjectionAvailable, tenderExecutiveRecommendation, tenderExecutiveOpenIssueCount, tenderRecommendationLabel } = await import(gateUrl);

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
assert.equal(tenderExecutiveOpenIssueCount(canonical), 2, 'Executive open issues must be 2 material questions, not 20 technical questions.');
const fallback = { ...canonical, decision_review: null };
assert.equal(tenderExecutiveRecommendation(fallback), 'pause');
assert.equal(tenderExecutiveOpenIssueCount(fallback), 20);
const unclassifiedV3 = { ...fallback, integral_analysis: { analysis_units: [{ unit_id: 'technical-1' }] } };
assert.equal(tenderExecutiveProjectionAvailable(unclassifiedV3), false);
assert.equal(tenderExecutiveOpenIssueCount(unclassifiedV3), 0, 'Unclassified V3 technical questions must never be presented as material executive alerts.');

const analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
assert.match(analysisSection, /function ExecutiveDecisionReviewPanel/);
assert.match(analysisSection, /Radar ejecutivo del caso/);
assert.match(analysisSection, /alertas materiales/i);
assert.match(analysisSection, /Radar ejecutivo pendiente de clasificación/);
assert.match(analysisSection, /hallazgos técnicos[\s\S]*no se presentan como alertas materiales/i);
assert.doesNotMatch(analysisSection, /ManizalesDecisionReviewPanel/);
assert.doesNotMatch(analysisSection, /Decisiones y aclaraciones de la encargada/);

const goPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
assert.match(goPanel, /tenderExecutiveRecommendation\(analysis\)/);
assert.match(goPanel, /tenderExecutiveOpenIssueCount\(analysis\)/);
assert.doesNotMatch(goPanel, /analysis\.critical_open_count/);

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const executiveIndex = main.indexOf('<TenderAnalysisSection');
const traceIndex = main.indexOf('<TenderIntegralAnalysisV3View');
assert.ok(executiveIndex > -1 && traceIndex > executiveIndex, 'Executive radar must render before technical requirement trace.');
assert.match(main, /<details className="tender-integral-analysis-trace"[^>]*>[\s\S]*Ver análisis técnico y trazabilidad por requisito[\s\S]*<TenderIntegralAnalysisV3View/);

console.log('tender executive projection and hierarchy checks passed');
