import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGT002_F0A_SCHEMA_VERSION,
  AGT002_F0A_REQUIRED_SURFACES,
  AGT002_F0A_FREEZE_CANONICAL_SHA256,
  classifyObservedProcess,
  findSupabaseOrPsqlMigrationRunners,
  validateAgt002F0aObservedReceipt,
  assertAgt002F0aDoesNotClaimPass,
} from '../agt002-f0a-control-plane.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// 1. schema version
assert.equal(AGT002_F0A_SCHEMA_VERSION, 'f0a.v1', 'schema version must be f0a.v1');

// 2. required surfaces
assert.deepEqual(
  AGT002_F0A_REQUIRED_SURFACES,
  [
    'origin_main',
    'vercel_production',
    'bridge',
    'radar_pipeline',
    'reanalysis_worker',
    'workbench_scheduler',
  ],
  'required surfaces must match exactly',
);

// 3. freeze canonical sha256
assert.equal(
  AGT002_F0A_FREEZE_CANONICAL_SHA256,
  'd7123520c4016a4963dfda7c36bdc5d5507f7ac0d5bb2b26c96193b1f95ef4b3',
  'freeze canonical sha256 must match the frozen manifest hash',
);

// 4. classifyObservedProcess: kernel kthread migration processes must not be confused with data migrations
assert.equal(
  classifyObservedProcess('     18 root     migration/0     [migration/0]'),
  'kernel_kthread',
  'migration/0 kernel thread must classify as kernel_kthread',
);
assert.equal(
  classifyObservedProcess('     19 root     migration/1     [migration/1]'),
  'kernel_kthread',
  'migration/1 kernel thread must classify as kernel_kthread',
);

// 5. classifyObservedProcess: supabase db push
assert.equal(
  classifyObservedProcess('supabase db push --linked'),
  'supabase_or_psql_migration',
  'supabase db push --linked must classify as supabase_or_psql_migration',
);

// 6. classifyObservedProcess: psql -f supabase/migrations
assert.equal(
  classifyObservedProcess('psql -f supabase/migrations/050_x.sql'),
  'supabase_or_psql_migration',
  'psql -f supabase/migrations/... must classify as supabase_or_psql_migration',
);

// 7. classifyObservedProcess: running bridge node process is unrelated
assert.equal(
  classifyObservedProcess('/usr/bin/node /opt/agt002-bridge/agt002-hetzner-bridge-server.js'),
  'other',
  'the running bridge node process must classify as other',
);

// 8. findSupabaseOrPsqlMigrationRunners: kernel-only process lines yield no runners
assert.deepEqual(
  findSupabaseOrPsqlMigrationRunners([
    '     18 root     migration/0     [migration/0]',
    '     19 root     migration/1     [migration/1]',
    '     20 root     migration/2     [migration/2]',
  ]),
  [],
  'kernel migration kthreads must never be reported as migration runners',
);

// 9. findSupabaseOrPsqlMigrationRunners: real migration runner is detected
const runnerLines = [
  '     18 root     migration/0     [migration/0]',
  '     19 root     migration/1     [migration/1]',
  '  4211 root     supabase migration up --linked',
];
const runnersFound = findSupabaseOrPsqlMigrationRunners(runnerLines);
assert.equal(runnersFound.length, 1, 'exactly one real migration runner must be detected among kernel noise');

// 10. runbook document exists and carries the required prohibitions
const runbookPath = path.join(repoRoot, 'docs/runbooks/agt002-f0a-unauthorized-migration-prohibition.md');
assert.ok(existsSync(runbookPath), 'F0-A unauthorized migration prohibition runbook must exist');
const runbookText = readFileSync(runbookPath, 'utf8');
assert.match(runbookText, /prohibición temporal/i, 'runbook must state the temporary prohibition');
assert.match(runbookText, /fuera del flujo autorizado/i, 'runbook must state migrations outside the authorized flow are prohibited');
assert.match(runbookText, /AUTHORIZE_F0/, 'runbook must reference the AUTHORIZE_F0 gate');
assert.ok(!runbookText.includes('F0-B'), 'runbook must not reference F0-B, which is out of scope for F0-A');

// Synthetic observed receipt shared by validation tests
function buildSyntheticReceipt(overrides = {}) {
  const base = {
    schema_version: AGT002_F0A_SCHEMA_VERSION,
    observed_at_utc: '2026-09-25T00:00:00.000Z',
    host: {
      hostname: 'agt002-f0a-observer',
      ipv4: '10.0.0.10',
    },
    freeze_canonical_sha256: AGT002_F0A_FREEZE_CANONICAL_SHA256,
    origin_main_sha: '9a0adb0d96b1a10838cedca9c3f58258d8a6efd0',
    surfaces: {
      origin_main: {
        sha: '9a0adb0d96b1a10838cedca9c3f58258d8a6efd0',
      },
      vercel_production: {
        sha: 'bb4d134af887e0dfbf99e02ca7cdf23153ab39da',
        deployment_id: 'dpl_45LcTwzUQHTCVbK1K86rLXHfosCJ',
      },
      bridge: {
        sha: '412a7eec125f03bbec9fb900005a08dba1c2c77d',
        historical_sha: '412a7eec125f03bbec9fb900005a08dba1c2c77d',
        port: '10/10',
      },
      radar_pipeline: {
        sha: 'b354c55806e1f8b805e5febfdfc6240b554e4867',
        dirty: 19,
      },
      reanalysis_worker: {
        sha: '20655a5d1e0264eaf38906a4f5bb5dd44f30df95',
      },
      workbench_scheduler: {
        mode: 'curl_wrapper',
      },
    },
    migration_runners: {
      supabase_or_psql: [],
    },
    claims: {
      f0a_pass: false,
    },
    env: {},
    secrets: false,
  };
  return { ...base, ...overrides };
}

// 11. a fully populated synthetic receipt validates ok
const completeReceipt = buildSyntheticReceipt();
assert.equal(
  validateAgt002F0aObservedReceipt(completeReceipt).ok,
  true,
  'a complete synthetic observed receipt must validate as ok',
);

// 12. missing radar_pipeline surface fails validation
const missingSurfaceReceipt = buildSyntheticReceipt();
delete missingSurfaceReceipt.surfaces.radar_pipeline;
assert.equal(
  validateAgt002F0aObservedReceipt(missingSurfaceReceipt).ok,
  false,
  'a receipt missing the radar_pipeline surface must fail validation',
);

// 13. receipt leaking a service role key must fail validation
const leakedSecretReceipt = buildSyntheticReceipt({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'sk-fake-leaked-value' },
});
assert.equal(
  validateAgt002F0aObservedReceipt(leakedSecretReceipt).ok,
  false,
  'a receipt carrying SUPABASE_SERVICE_ROLE_KEY in env must fail validation',
);

// 14. a receipt claiming f0a_pass must fail validation and must throw the dedicated assertion
const passClaimingReceipt = buildSyntheticReceipt({ claims: { f0a_pass: true } });
assert.equal(
  validateAgt002F0aObservedReceipt(passClaimingReceipt).ok,
  false,
  'a receipt that claims f0a_pass must fail validation; F0-A is observation-only',
);
assert.throws(
  () => assertAgt002F0aDoesNotClaimPass(passClaimingReceipt),
  'assertAgt002F0aDoesNotClaimPass must throw when claims.f0a_pass is true',
);
assert.doesNotThrow(
  () => assertAgt002F0aDoesNotClaimPass(completeReceipt),
  'assertAgt002F0aDoesNotClaimPass must not throw for a valid non-claiming receipt',
);

// 15. committed evidence file for 2026-09-25 exists, validates, and does not claim pass
const evidencePath = path.join(repoRoot, 'docs/evidence/2026-09-25-agt002-f0a-observed-state.json');
assert.ok(existsSync(evidencePath), 'the committed F0-A observed-state evidence file must exist');
const evidenceReceipt = JSON.parse(readFileSync(evidencePath, 'utf8'));
const evidenceValidation = validateAgt002F0aObservedReceipt(evidenceReceipt);
assert.equal(evidenceValidation.ok, true, 'the committed evidence receipt must validate as ok');
assert.doesNotThrow(
  () => assertAgt002F0aDoesNotClaimPass(evidenceReceipt),
  'the committed evidence receipt must not claim f0a_pass',
);
assert.equal(
  evidenceReceipt.freeze_canonical_sha256,
  AGT002_F0A_FREEZE_CANONICAL_SHA256,
  'the committed evidence receipt must reference the frozen canonical hash',
);
assert.equal(
  evidenceReceipt.origin_main_sha,
  '9a0adb0d96b1a10838cedca9c3f58258d8a6efd0',
  'the committed evidence receipt must reference the observed origin/main sha',
);
assert.deepEqual(
  evidenceReceipt.migration_runners.supabase_or_psql,
  [],
  'the committed evidence receipt must show no unauthorized migration runners observed',
);

// 16. the control-plane module source must never itself carry out restarts, daemon reloads, or migration commands
const modulePath = path.join(repoRoot, 'agt002-f0a-control-plane.js');
const moduleSource = readFileSync(modulePath, 'utf8');
assert.doesNotMatch(moduleSource, /systemctl\s+(restart|stop|start|daemon-reload)/, 'module must never issue systemctl restart/stop/start/daemon-reload');
assert.doesNotMatch(moduleSource, /supabase\s+(db|migration)\s+\w+/, 'module must never issue supabase db/migration commands');

console.log('AGT-002 F0-A control-plane tests passed');
