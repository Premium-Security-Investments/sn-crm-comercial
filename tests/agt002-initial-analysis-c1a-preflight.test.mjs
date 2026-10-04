import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  BACKUP_RECEIPT_SCHEMA,
  REQUIRED_ENV_KEYS,
  buildC1aPreflightReceipt,
  parseProtectedEnv,
  sanitizeInitialEnvironment,
  validateBackupReceipt,
} from '../scripts/agt002-initial-analysis-c1a-preflight.mjs';

const SHA = '90bf8662debf56d29a44ddf4a6515b62c9c93ec1';
const SECRET = 's'.repeat(48);

const validEnv = Object.freeze({
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  AGT002_BRIDGE_HMAC_SECRET: SECRET,
  AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'false',
  AGT002_MODEL_CALLS_ENABLED: 'false',
  AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY: 'agt002-initial-analysis-worker',
  AGT002_INITIAL_ANALYSIS_MODEL_ID: 'approved-model',
  AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS: '12000',
  AGT002_INITIAL_ANALYSIS_MAX_COST_USD: '10',
  AGT002_INITIAL_ANALYSIS_TIMEOUT_MS: '30000',
  AGT002_INITIAL_ANALYSIS_REASONING_EFFORT: 'medium',
  AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD: '1.25',
  AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD: '10',
});

const validBackup = Object.freeze({
  schema_version: BACKUP_RECEIPT_SCHEMA,
  backup_id: 'supabase-backup-20261004T120000Z',
  created_at_utc: '2026-10-04T12:00:00.000Z',
  database_host: 'project-ref.supabase.co',
  integrity_verified: true,
  restore_procedure_id: 'supabase-pitr-isolated-v1',
  restore_tested_at_utc: '2026-10-04T12:20:00.000Z',
  restore_result: 'PASS',
});

function passingFacts() {
  const environment = sanitizeInitialEnvironment(validEnv);
  return {
    repo: {
      path: '/root/worktrees/siio-e6-scheduler-fix',
      fetch_ok: true,
      clean: true,
      head_sha: SHA,
      origin_main_sha: SHA,
    },
    environment: {
      exists: true,
      owner: 'root',
      mode: '640',
      ...environment,
      configured: { ...environment.configured },
      kill_switches: { ...environment.kill_switches },
    },
    worker: {
      service: { enabled: 'not-found', active: 'inactive' },
      timer: { enabled: 'not-found', active: 'inactive' },
      process_observed: true,
      process_count: 0,
    },
    backup: { ...validateBackupReceipt(validBackup) },
    control_plane: { observed: true, sha: '356143900cb367eb1c17a050a9fe5d750654da7a', version: 'f0-3561439' },
    database: {
      preflight_ok: true,
      status: 'absent',
      migrations: Object.fromEntries(['099', '100', '101', '102', '103', '104'].map(id => [id, false])),
      unsafe_grants: 0,
      rls_missing: 0,
      missing_service_access: 0,
    },
  };
}

test('protected env parsing is declarative and never evaluates shell syntax', () => {
  globalThis.__agt002C1aInjected = false;
  const parsed = parseProtectedEnv(`
# comment
SUPABASE_URL='https://project-ref.supabase.co'
SUPABASE_SERVICE_ROLE_KEY="$(globalThis.__agt002C1aInjected=true)"
AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED=false
`);
  assert.equal(parsed.SUPABASE_URL, 'https://project-ref.supabase.co');
  assert.equal(parsed.SUPABASE_SERVICE_ROLE_KEY, '$(globalThis.__agt002C1aInjected=true)');
  assert.equal(globalThis.__agt002C1aInjected, false);
  delete globalThis.__agt002C1aInjected;
});

test('environment projection proves required configuration without returning secrets', () => {
  const projection = sanitizeInitialEnvironment(validEnv);
  assert.equal(projection.supabase_host, 'project-ref.supabase.co');
  assert.equal(projection.kill_switches.admission_enabled, false);
  assert.equal(projection.kill_switches.model_calls_enabled, false);
  assert.deepEqual(Object.keys(projection.configured).sort(), [...REQUIRED_ENV_KEYS].sort());
  assert.ok(Object.values(projection.configured).every(Boolean));
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /service-role-secret/);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
});

test('backup receipt is bound to a tested restore and exposes no arbitrary fields', () => {
  const receipt = validateBackupReceipt({ ...validBackup, ignored_secret: SECRET });
  assert.deepEqual(receipt, {
    valid: true,
    schema_version: BACKUP_RECEIPT_SCHEMA,
    backup_id: validBackup.backup_id,
    created_at_utc: validBackup.created_at_utc,
    database_host: validBackup.database_host,
    integrity_verified: true,
    restore_procedure_id: validBackup.restore_procedure_id,
    restore_tested_at_utc: validBackup.restore_tested_at_utc,
    restore_result: 'PASS',
  });
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(SECRET));
});

test('all C1A pre-change evidence yields READY_FOR_E2 without authorizing a canary', () => {
  const receipt = buildC1aPreflightReceipt({
    facts: passingFacts(),
    now: () => '2026-10-04T13:00:00.000Z',
  });
  assert.equal(receipt.decision, 'READY_FOR_E2');
  assert.equal(receipt.authorizes, 'MIGRATIONS_099_104_AND_DEPLOY_FLAGS_OFF_ONLY');
  assert.equal(receipt.canary_authorized, false);
  assert.ok(receipt.checks.every(check => check.ok));
});

test('an installed static unit is off when it is inactive; the timer must also be inactive', () => {
  const facts = passingFacts();
  facts.worker.service = { enabled: 'static', active: 'inactive' };
  facts.worker.timer = { enabled: 'static', active: 'inactive' };
  assert.equal(buildC1aPreflightReceipt({ facts }).decision, 'READY_FOR_E2');
  facts.worker.timer.active = 'active';
  assert.equal(buildC1aPreflightReceipt({ facts }).decision, 'BLOCKED');
});

for (const [name, mutate, expectedCode] of [
  ['stale repository', facts => { facts.repo.origin_main_sha = '0'.repeat(40); }, 'repo_exact_sha'],
  ['dirty repository', facts => { facts.repo.clean = false; }, 'repo_clean'],
  ['missing fresh fetch', facts => { facts.repo.fetch_ok = false; }, 'repo_fresh_fetch'],
  ['enabled admission', facts => { facts.environment.kill_switches.admission_enabled = true; }, 'kill_switches_off'],
  ['enabled timer', facts => { facts.worker.timer.enabled = 'enabled'; }, 'initial_timer_off'],
  ['worker process', facts => { facts.worker.process_count = 1; }, 'initial_worker_absent'],
  ['unobserved process table', facts => { facts.worker.process_observed = false; }, 'initial_worker_absent'],
  ['wrong backup target', facts => { facts.backup.database_host = 'other.supabase.co'; }, 'backup_target_identity'],
  ['missing restore proof', facts => { facts.backup.restore_result = 'FAIL'; }, 'backup_restore_verified'],
  ['unobserved control plane', facts => { facts.control_plane.observed = false; }, 'control_plane_observed'],
  ['database drift', facts => { facts.database.status = 'drift'; }, 'database_preflight'],
  ['unobserved database counters', facts => { facts.database.unsafe_grants = null; }, 'database_preflight'],
]) {
  test(`preflight blocks on ${name}`, () => {
    const facts = passingFacts();
    mutate(facts);
    const receipt = buildC1aPreflightReceipt({ facts });
    assert.equal(receipt.decision, 'BLOCKED');
    assert.equal(receipt.checks.find(check => check.code === expectedCode)?.ok, false);
  });
}

test('placeholder runtime values are never accepted as configured', () => {
  const projection = sanitizeInitialEnvironment({
    ...validEnv,
    SUPABASE_SERVICE_ROLE_KEY: 'YOUR_SERVICE_ROLE_KEY',
    AGT002_BRIDGE_HMAC_SECRET: 'YOUR_SERVER_ONLY_SIGNING_SECRET_AT_LEAST_32_BYTES',
    AGT002_INITIAL_ANALYSIS_MODEL_ID: 'YOUR_APPROVED_MODEL',
  });
  assert.equal(projection.configured.SUPABASE_SERVICE_ROLE_KEY, false);
  assert.equal(projection.configured.AGT002_BRIDGE_HMAC_SECRET, false);
  assert.equal(projection.configured.AGT002_INITIAL_ANALYSIS_MODEL_ID, false);
});

test('the operator command and fail-closed receipt contract are documented', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const runbook = readFileSync(new URL('../docs/runbooks/agt002-initial-analysis-c1a-release.md', import.meta.url), 'utf8');
  assert.equal(
    packageJson.scripts['preflight:agt002-initial-c1a'],
    'node scripts/agt002-initial-analysis-c1a-preflight.mjs',
  );
  assert.match(runbook, /AGT002_C1A_BACKUP_RECEIPT_FILE=/);
  assert.match(runbook, /decision: READY_FOR_E2/);
  assert.match(runbook, /canary\s+unauthorized/i);
  assert.match(runbook, new RegExp(BACKUP_RECEIPT_SCHEMA));
});
