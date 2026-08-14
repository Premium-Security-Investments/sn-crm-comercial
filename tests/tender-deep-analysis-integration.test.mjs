import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildTenderDeepAnalysis } from '../tender-deep-analysis.js';

const documents = [
  {
    id: 'doc-pliego',
    name: 'Pliego vigente.pdf',
    document_type: 'pliego',
    extracted_text: 'Se exige póliza de cumplimiento por el 15% del valor del contrato con vigencia de 12 meses.',
  },
  {
    id: 'doc-financiero',
    name: 'Estudios previos.pdf',
    document_type: 'estudios_previos',
    extracted_text: 'El capital de trabajo debe ser no inferior a $500.000.000.',
  },
  {
    id: 'doc-tecnico',
    name: 'Anexo técnico.pdf',
    document_type: 'anexo_tecnico',
    extracted_text: 'El alcance incluye monitoreo CCTV y control de acceso en las sedes.',
  },
];
const companyProfile = { working_capital: 600000000, guarantee_capacity_pct: 20 };

const analysis = buildTenderDeepAnalysis(documents, companyProfile);
assert.equal(analysis.version, '1.0');
assert.deepEqual(Object.keys(analysis.matrix).sort(), ['financial', 'legal', 'technical']);
assert.equal(analysis.coverage.total, 3);
assert.ok(analysis.strengths.some(item => item.includes('Capital de trabajo')));
assert.equal(analysis.blockers.length, 0);
assert.ok(analysis.questions.some(question => question.front === 'technical'));
assert.ok(analysis.unverified.some(item => item.includes('videovigilancia')));
assert.equal(typeof analysis.next_action, 'string');
assert.ok(analysis.next_action.length > 0);

const legalEvidence = analysis.matrix.legal.flatMap(requirement => requirement.evidence || []);
assert.ok(legalEvidence.some(evidence => evidence.document_id === 'doc-pliego'));
assert.ok(legalEvidence.every(evidence => evidence.excerpt.length <= 160));
assert.doesNotMatch(JSON.stringify(analysis), /cumple autom[aá]ticamente|GO autom[aá]tico|NO GO autom[aá]tico/i);

const reversed = buildTenderDeepAnalysis([...documents].reverse(), { guarantee_capacity_pct: 20, working_capital: 600000000 });
assert.deepEqual(reversed, analysis, 'deep analysis must be deterministic across document and profile key order');

const governedDocuments = [
  ...documents,
  {
    id: 'doc-polizas-habilitantes',
    name: 'Requisitos habilitantes.pdf',
    document_type: 'pliego',
    extracted_text: 'Como requisito habilitante se exige póliza de responsabilidad civil extracontractual y póliza de vida colectiva para el personal.',
  },
];
const legacyIds = buildTenderDeepAnalysis(governedDocuments, companyProfile).matrix.legal.map(item => item.id);
assert.deepEqual(legacyIds, ['legal-guarantee-policy'], 'v2 must preserve the legacy generic legal requirement');
const governed = buildTenderDeepAnalysis(governedDocuments, companyProfile, { governedRequirements: true });
const governedIds = governed.matrix.legal.map(item => item.id);
assert.deepEqual(governedIds, ['legal-rce-policy', 'legal-collective-life-policy'], 'v3 must use the two human-approved governed legal requirements');
assert.equal(governed.coverage.total, 4, 'v3 governed analysis must expose the complete four-requirement manifest source');
assert.ok(!governedIds.includes('legal-guarantee-policy'), 'v3 must never leak the legacy generic legal requirement');

for (const backendPath of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(backendPath, import.meta.url), 'utf8');
  assert.match(source, /import\s+\{\s*buildTenderDeepAnalysis\s*\}\s+from\s+'\.\.\/tender-deep-analysis\.js';/);
  const builder = source.slice(source.indexOf('function buildTenderDocumentAnalysis'), source.indexOf('async function getTenderDocumentRecords'));
  assert.match(builder, /const deepAnalysis = buildTenderDeepAnalysis\(documents, companyProfile,\s*\{ governedRequirements: agt002AnalysisConfig\.AGT002_INTEGRAL_CONTRACT_V3 \}\);/);
  assert.match(builder, /deep_analysis:\s*deepAnalysis/);
  assert.match(builder, /recommendation, risk/);
  assert.match(builder, /go_no_go:\s*goNoGo/);
}

console.log('tender deep analysis wave 3 integration passed');
