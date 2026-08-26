import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const DECISION_PATH_FILES = [
  'agt002-radar-gate.js', 'agt002-radar-visibility.js',
  'agt002-radar-preanalysis-contract.js', 'agt002-radar-preanalysis-input.js',
  'agt002-radar-preanalysis-runtime.js', 'agt002-radar-preanalysis-persistence.js',
  'agt002-radar-preanalysis-jobs.js', 'agt002-radar-preanalysis-worker.js',
  'agt002-radar-pipeline.js',
  'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs',
  'supabase/migrations/071_agt002_radar_gate.sql',
  'supabase/migrations/072_agt002_radar_preanalysis_ledger.sql',
  'scripts/agt002-radar-preanalysis-dryrun.mjs',
];
const READ_ONLY_REPORT_FILES = [
  'scripts/agt002-radar-gate-historical-audit.mjs',
  'agt002-radar-learning-projection.js',
  'agt002-radar-learning-retrieval.js', 'agt002-radar-learning-proposals.js',
  'scripts/agt002-radar-learning-signals-report.mjs',
];
const CONVERSION_FORBIDDEN = [
  'psi_sales_opportunities', 'psi_convert_tender_to_opportunity', 'tender-convert',
  'converted_opportunity_id', 'internal_status',
];
const DECISION_FORBIDDEN = ['psi_tender_go_no_go_decisions', 'go_no_go', "'go'", "'no_go'"];

for (const file of [...DECISION_PATH_FILES, ...READ_ONLY_REPORT_FILES]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  if (DECISION_PATH_FILES.includes(file) && file !== 'agt002-radar-preanalysis-contract.js') {
    for (const forbidden of CONVERSION_FORBIDDEN) assert.equal(source.includes(forbidden), false, `${file} no debe referenciar ${forbidden}`);
  }
  assert.equal(/(?:database|db)\.from\([^)]*\)[\s\S]{0,240}\.(insert|update|upsert|delete)\(/.test(source), false, `${file} no debe escribir en base de datos`);
  assert.equal(/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(source), false, `${file} debe ser de sólo lectura`);
}
for (const file of DECISION_PATH_FILES) {
  if (file === 'agt002-radar-preanalysis-contract.js') continue;
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const forbidden of DECISION_FORBIDDEN) assert.equal(source.includes(forbidden), false, `${file} no debe referenciar ${forbidden}`);
}
for (const file of READ_ONLY_REPORT_FILES) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(source.includes('--apply'), false, `${file} no debe aceptar bandera de escritura`);
  assert.equal(/psi_record_agt002_radar|psi_append_agt002_radar/.test(source), false, `${file} no debe persistir`);
  assert.equal(/decision:\s*['"](go|no_go)['"]\s*[,}]/.test(source.replace(/decision === ['"](go|no_go)['"]/g, '')), false, `${file} no debe emitir una decisión`);
}
for (const file of ['agt002-radar-gate.js', 'agt002-radar-visibility.js']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(/learning/i.test(source), false, `${file} no debe conocer el aprendizaje`);
}
assert.match(readFileSync(new URL('../agt002-radar-preanalysis-input.js', import.meta.url), 'utf8'), /learningSignals/);
const runner = readFileSync(new URL('../ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs', import.meta.url), 'utf8');
assert.equal(runner.includes('systemctl'), false);
assert.equal(/AGT002_RADAR_(GATE|VISIBILITY)\s*=\s*['"]?(true|1)/.test(runner), false);
for (const file of [...DECISION_PATH_FILES, ...READ_ONLY_REPORT_FILES]) assert.equal(file.startsWith('src/'), false);

console.log('AGT-002 conversion and GO/NO-GO authority invariants passed');
