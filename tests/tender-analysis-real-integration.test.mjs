import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const root = new URL('../', import.meta.url);
const previewComponentPath = new URL('src/tenders/components/TenderAnalysisV3Preview.tsx', root);
const previewCssPath = new URL('src/tenders/components/tender-analysis-v3-preview.css', root);
const previewTestPath = new URL('tests/agt002-v3-synthetic-preview-ui.test.mjs', root);
const moduleSource = readFileSync(new URL('src/tenders/TendersModule.tsx', root), 'utf8');
const sectionSource = readFileSync(new URL('src/tenders/components/TenderAnalysisSection.tsx', root), 'utf8');
const briefSource = readFileSync(new URL('src/tenders/tenderDecisionBrief.ts', root), 'utf8');
const main = readFileSync(new URL('src/main.tsx', root), 'utf8');

// 1) The synthetic AGT-002 v3 preview and its hidden route must be fully removed.
assert.equal(existsSync(previewComponentPath), false, 'El componente de preview sintético debe eliminarse.');
assert.equal(existsSync(previewCssPath), false, 'El CSS del preview sintético debe eliminarse.');
assert.equal(existsSync(previewTestPath), false, 'La prueba del preview sintético debe eliminarse.');
assert.doesNotMatch(moduleSource, /agt002-v3/, 'TendersModule no debe conservar la ruta oculta del preview sintético.');
assert.doesNotMatch(moduleSource, /TenderAnalysisV3Preview/, 'TendersModule no debe importar el preview sintético.');
assert.doesNotMatch(moduleSource, /LIC-SYN-2026-017|Entidad Pública Demo/, 'No debe quedar rastro de datos ficticios en el módulo de licitaciones.');

// 2) TenderAnalysisSection must render real opportunity metadata, document counts and critical counts.
assert.match(sectionSource, /metadata/, 'TenderAnalysisSection debe recibir metadata real de la oportunidad.');
assert.match(sectionSource, /tenderCurrentDocumentCount/, 'TenderAnalysisSection debe mostrar el conteo real de documentos actuales.');
assert.match(sectionSource, /critical_open_count/, 'TenderAnalysisSection debe mostrar los críticos abiertos reales.');
assert.match(sectionSource, /mergeTenderEvidence/, 'TenderAnalysisSection debe combinar debilidades y bloqueadores reales sin ocultar ninguno.');
assert.match(sectionSource, /id="tender-analysis"/, 'El ancla de la sección de análisis debe conservarse para el deep link.');
assert.match(sectionSource, /tabIndex=\{-1\}/, 'El ancla de análisis debe ser enfocable programáticamente.');
assert.doesNotMatch(sectionSource, /LIC-SYN-2026-017|Entidad Pública Demo|Rama Judicial|Manizales/i, 'No debe hardcodear ninguna oportunidad ni entidad sintética o específica.');
assert.doesNotMatch(sectionSource, /GoNoGo|LICITACIONES_GO_NO_GO_APPROVE/, 'Análisis no debe incluir controles GO / NO-GO.');

// Existing human flows (questions, reanalysis, processing/fallback) must survive the rewrite.
for (const keep of ['QuestionResponseCard', 'onSaveQuestionResponse', 'onAnalyzePreview', 'processingStatus', 'onRetryProcessing', 'analysisEngine?.fallback']) {
  assert.match(sectionSource, new RegExp(keep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `TenderAnalysisSection debe conservar ${keep}.`);
}

// 3) Deep link focus=analysis must be supported alongside the existing focus targets.
assert.match(main, /documentFocusRequested = focusTarget === 'documents'/);
assert.match(main, /interactionFocusRequested = focusTarget === 'interaction'/);
assert.match(main, /analysisFocusRequested = focusTarget === 'analysis'/, 'OpportunityDetail debe reconocer focus=analysis.');
assert.match(main, /getElementById\('tender-analysis'\)/, 'focus=analysis debe enfocar el ancla real de la sección de análisis.');
assert.match(main, /metadata=\{tenderAnalysisOpportunityMetadata\(opportunity\)\}/, 'main debe pasar metadata real de la oportunidad al componente de análisis.');

console.log('static assertions passed, checking pure evidence/document helpers');

// 4) Pure helpers used by the UI must be real, testable logic — not fabricated compliance signals.
const bundle = buildSync({
  entryPoints: [new URL('src/tenders/tenderDecisionBrief.ts', root).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const briefUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { mergeTenderEvidence, tenderCurrentDocumentCount, tenderEvidenceCoverageSummary, tenderAnalysisOpportunityMetadata } = await import(briefUrl);

assert.equal(tenderCurrentDocumentCount([{ current: true }, { current: false }, { current: true }, {}]), 3, 'Debe contar solo documentos vigentes (current !== false).');
assert.equal(tenderCurrentDocumentCount([]), 0);

const absentCoverage = tenderEvidenceCoverageSummary(null);
assert.equal(absentCoverage.available, false, 'Sin evidence_coverage persistido, la cobertura debe marcarse explícitamente como no disponible, nunca inferida.');
assert.equal(absentCoverage.citationCount, null);

const realCoverage = tenderEvidenceCoverageSummary({
  budget: { max_chunks: 40, max_chars: 1, max_tokens: 8000, chunks_used: 12, chars_used: 1, tokens_used: 3000, chunks_remaining: 28, chars_remaining: 0, tokens_remaining: 5000 },
  coverage_manifest: { by_document: [], by_document_type: [], by_requirement: [
    { requirement_id: 'r1', candidates_available: 3, chunks_selected: 2, status: 'covered' },
    { requirement_id: 'r2', candidates_available: 0, chunks_selected: 0, status: 'no_evidence' },
    { requirement_id: 'r3', candidates_available: 1, chunks_selected: 0, status: 'not_covered' },
  ] },
  selected_chunks: [], omitted_chunks: [], citation_allowlist: ['a', 'b', 'c'], material_omissions: false, requirement_manifest_version: 'v1', requirement_manifest: [], snapshot_id: 'snap-1',
});
assert.equal(realCoverage.available, true);
assert.equal(realCoverage.chunksUsed, 12);
assert.equal(realCoverage.requirementsCovered, 1);
assert.equal(realCoverage.requirementsNotCovered, 1);
assert.equal(realCoverage.requirementsNoEvidence, 1);
assert.equal(realCoverage.requirementsTotal, 3);
assert.equal(realCoverage.citationCount, 3);

assert.deepEqual(mergeTenderEvidence([{ text: 'Debilidad real' }], [{ text: 'Bloqueador real' }, { text: 'Debilidad real' }]), ['Debilidad real', 'Bloqueador real'], 'Debe combinar debilidades y bloqueadores sin ocultarlos ni duplicarlos.');
assert.deepEqual(tenderAnalysisOpportunityMetadata({ company_name: '  Entidad Territorial X  ', expected_close_date: '2030-02-03', offer_value: 125000000 }), { entity: 'Entidad Territorial X', processReference: null, expectedCloseDate: '2030-02-03', offerValue: 125000000 }, 'Los metadatos deben venir exclusivamente de la oportunidad real, sin inventar un número de proceso inexistente.');
assert.deepEqual(tenderAnalysisOpportunityMetadata(null), { entity: null, processReference: null, expectedCloseDate: null, offerValue: null });

console.log('tender analysis real-data integration passed');
