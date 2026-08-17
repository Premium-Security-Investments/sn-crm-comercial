// Deterministic local visual QA for the Phase 4 honest manifest_scope coverage panel.
//
// Renders the REAL TenderIntegralAnalysisV3View component (server-side, via react-dom/server)
// against a deterministic fixture built from the checked-in Manizales SA-24-2026 manifest — real
// labels, real ids — inlines the real component CSS, and captures a PNG with headless Chromium.
// No network, no provider canary, no DB. Fully reproducible: no clock/random anywhere.
//
// Usage: node scripts/agt002-manifest-scope-visual-qa.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { deriveAgt002ManizalesManifestScope } from '../agt002-manizales-manifest-wiring.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'data/agt002/manizales-sa-24-2026.integral-manifest.v1.json'), 'utf8'));
const scope = deriveAgt002ManizalesManifestScope(manifest);

// Real analyzable entries (20), with real proposal-ledger labels for the unit titles.
const labelById = new Map(manifest.proposal_ledger.map(item => [item.requirement_id, item.label]));
const analyzableEntries = manifest.entries.filter(entry => entry.analyzable === true);

const CATEGORY_TO_UI = { habilitating: 'habilitating', technical: 'technical', financial_execution: 'financial_execution', discard: 'discard' };
const analysisUnits = analyzableEntries.map((entry, index) => ({
  unit_id: `UNIT-${index + 1}`, unit_kind: 'tender_requirement', requirement_id: entry.requirement_id,
  category: CATEGORY_TO_UI[entry.category] ?? 'habilitating', sequence: index + 1,
  title: labelById.get(entry.requirement_id) ?? entry.requirement_id, assessment_mode: 'abstained',
  conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana obligatoria.', confidence: 'unavailable' },
  blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática; requiere revisión humana.' },
  evidence_state: { presence: 'unknown', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown' },
  evidence_refs: [], missing_evidence: [],
  commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
  legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico.', human_legal_review_required: false },
  actions: [],
  milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
  escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
  closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
  human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
}));

const analysis = {
  run_id: '99999999-9999-4999-8999-999999999999',
  snapshot_id: '55555555-5555-4555-8555-555555555555',
  producer: 'AGT-002', method: 'agent_ai', status: 'completed', current: true, critical_open_count: 0,
  integral_analysis: {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1',
      expected_requirement_ids: scope.analyzable_requirement_ids,
      analyzed_requirement_ids: scope.analyzable_requirement_ids,
      material_omissions: false, omission_reasons: [],
      company_evidence_manifest_version: 'agt002-company-evidence-classes-v1', company_evidence_class_ids: [],
      legal_corpus_version_id: null,
    },
    analysis_units: analysisUnits,
  },
  manifest_scope: scope,
};

// Transpile the real component (strip the CSS side-effect import; automatic JSX runtime).
const tsxPath = resolve(root, 'src/tenders/components/TenderIntegralAnalysisV3View.tsx');
const tsx = readFileSync(tsxPath, 'utf8').replace(/^import '\.\/tender-integral-analysis-v3\.css';\n/m, '');
const { code } = await esbuild.transform(tsx, { loader: 'tsx', jsx: 'automatic', format: 'esm', sourcefile: 'TenderIntegralAnalysisV3View.tsx' });

const qaDir = resolve(root, 'dist/_qa');
if (!existsSync(qaDir)) mkdirSync(qaDir, { recursive: true });
const modulePath = resolve(qaDir, 'view.mjs');
writeFileSync(modulePath, code, 'utf8');
const { TenderIntegralAnalysisV3View } = await import(`${modulePath}?t=${scope.atomized_entry_count}`);

const markup = renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis }));
const css = readFileSync(resolve(root, 'src/tenders/components/tender-integral-analysis-v3.css'), 'utf8');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>AGT-002 V3 · manifest_scope QA</title>
<style>:root{--v3-line:#dbe4f0}*{box-sizing:border-box}body{margin:0;padding:28px;background:#eef2f8;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#10213d}main{max-width:1180px;margin:0 auto}
${css}</style></head><body><main>${markup}</main></body></html>`;

const outDir = resolve(root, 'docs/verification/screenshots');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const htmlPath = resolve(outDir, 'agt002-manifest-scope.html');
const pngPath = resolve(outDir, 'agt002-manifest-scope.png');
writeFileSync(htmlPath, html, 'utf8');

// Deterministic assertions on the rendered markup — real manifest labels, honest figures.
const checks = [
  ['Requisitos analizables', /Requisitos analizables/],
  ['20 / 25 (analizables / atomizadas)', /20 \/ 25/],
  ['Secciones pre-GO del manifiesto', /Secciones pre-GO del manifiesto/],
  ['15 (68 registradas)', /15 \(68 registradas\)/],
  ['Secciones 15/15 · Propuestas 20/20', /Secciones 15\/15 · Propuestas 20\/20/],
  ['dispositions 30 / 0 / 5', /Candidatas analizadas 30 · Excluidas con razón 0 · No resueltas visibles 5/],
];
const failures = [];
for (const [label, re] of checks) if (!re.test(markup)) failures.push(label);
// The misleading generic total must NOT appear for a manifest-driven run.
if (/<small>Cobertura<\/small>/.test(markup)) failures.push('rendered a generic "Cobertura" label (must be absent under manifest_scope)');
if (/\b4 ?\/ ?4\b/.test(markup)) failures.push('rendered a bare misleading 4/4');
if (failures.length) { console.error('VISUAL QA ASSERTIONS FAILED:\n- ' + failures.join('\n- ')); process.exit(1); }

// Capture a PNG with headless Chromium (no network).
const chromium = process.env.CHROMIUM_BIN || 'chromium-browser';
execFileSync(chromium, [
  '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1240,1180', `--screenshot=${pngPath}`, `file://${htmlPath}`,
], { stdio: 'ignore' });

const evidence = [
  'AGT-002 Phase 4 — deterministic visual QA (honest manifest_scope coverage)',
  '',
  `HTML render : docs/verification/screenshots/agt002-manifest-scope.html`,
  `PNG capture : docs/verification/screenshots/agt002-manifest-scope.png`,
  '',
  'Honest figures verified in the rendered real component (real manifest labels):',
  `  Requisitos analizables : ${scope.analyzable_requirement_ids.length} / ${scope.atomized_entry_count}`,
  `  Secciones pre-GO       : ${scope.pre_go_relevant} (${scope.registry_sections} registradas)`,
  `  Libros conciliados     : Secciones ${scope.section_ledger_accounted}/${scope.pre_go_relevant} · Propuestas ${scope.proposal_ledger_accounted}/${scope.proposal_ledger_accounted}`,
  `  Disposiciones          : analyzed_candidate=${scope.dispositions.analyzed_candidate} excluded_with_reason=${scope.dispositions.excluded_with_reason} unresolved_visible=${scope.dispositions.unresolved_visible}`,
  '',
  'Negative checks: no generic "Cobertura" label under manifest_scope; no bare misleading 4/4.',
  'All visual-QA assertions passed.',
  '',
].join('\n');
writeFileSync(resolve(outDir, 'agt002-manifest-scope-qa.txt'), evidence, 'utf8');
console.log(evidence);
