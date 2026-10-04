#!/usr/bin/env node

import { lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_RECEIPT_SCHEMA = 'agt002-c1a-backup-receipt-v1';
export const PRODUCTION_REPO = '/root/worktrees/siio-e6-scheduler-fix';
export const PRODUCTION_ENV_FILE = '/etc/psi-agt002-initial-analysis/env';
export const CONTROL_PLANE_URL = 'https://seguridad-nacional-crm.vercel.app/api/agt002/control-plane';
export const INITIAL_SERVICE = 'agt002-initial-analysis-worker.service';
export const INITIAL_TIMER = 'agt002-initial-analysis-worker.timer';

export const REQUIRED_ENV_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AGT002_BRIDGE_HMAC_SECRET',
  'AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED',
  'AGT002_MODEL_CALLS_ENABLED',
  'AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY',
  'AGT002_INITIAL_ANALYSIS_MODEL_ID',
  'AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS',
  'AGT002_INITIAL_ANALYSIS_MAX_COST_USD',
  'AGT002_INITIAL_ANALYSIS_TIMEOUT_MS',
  'AGT002_INITIAL_ANALYSIS_REASONING_EFFORT',
  'AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD',
  'AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_OFF_ENABLED_STATES = new Set(['disabled', 'masked', 'not-found', 'static']);
const SAFE_OFF_ACTIVE_STATES = new Set(['inactive', 'not-found']);
const MIGRATION_STATES = new Set(['absent', 'partial', 'applied']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function configuredValue(value) {
  return nonEmpty(value) && !/^(?:YOUR_|REPLACE_ME|CHANGEME|PLACEHOLDER)/i.test(value.trim());
}

function positiveNumber(value, { integer = false } = {}) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && (!integer || Number.isInteger(parsed));
}

function isoDate(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function normalizeSha(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SHA_PATTERN.test(normalized) ? normalized : null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function urlHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && nonEmpty(url.hostname) ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function parseProtectedEnv(source) {
  const result = Object.create(null);
  for (const raw of String(source || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("'") && value.endsWith("'"))
      || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

export function sanitizeInitialEnvironment(environment = {}) {
  const supabaseHost = urlHost(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL);
  const configured = Object.fromEntries(REQUIRED_ENV_KEYS.map(key => [key, configuredValue(environment[key])]));
  configured.SUPABASE_URL = supabaseHost !== null;
  configured.SUPABASE_SERVICE_ROLE_KEY = configuredValue(environment.SUPABASE_SERVICE_ROLE_KEY);
  configured.AGT002_BRIDGE_HMAC_SECRET = configuredValue(environment.AGT002_BRIDGE_HMAC_SECRET)
    && String(environment.AGT002_BRIDGE_HMAC_SECRET).length >= 32;
  configured.AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY = environment.AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY === 'agt002-initial-analysis-worker';
  configured.AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS, { integer: true });
  configured.AGT002_INITIAL_ANALYSIS_MAX_COST_USD = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_MAX_COST_USD);
  configured.AGT002_INITIAL_ANALYSIS_TIMEOUT_MS = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_TIMEOUT_MS, { integer: true });
  configured.AGT002_INITIAL_ANALYSIS_REASONING_EFFORT = EFFORTS.has(environment.AGT002_INITIAL_ANALYSIS_REASONING_EFFORT);
  configured.AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD);
  configured.AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD = positiveNumber(environment.AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD);
  return Object.freeze({
    supabase_host: supabaseHost,
    configured: Object.freeze(configured),
    kill_switches: Object.freeze({
      admission_enabled: environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED === 'true',
      model_calls_enabled: environment.AGT002_MODEL_CALLS_ENABLED === 'true',
      admission_literal: environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED || null,
      model_calls_literal: environment.AGT002_MODEL_CALLS_ENABLED || null,
    }),
  });
}

export function validateBackupReceipt(input = {}) {
  const projection = {
    valid: false,
    schema_version: input.schema_version === BACKUP_RECEIPT_SCHEMA ? input.schema_version : null,
    backup_id: nonEmpty(input.backup_id) ? input.backup_id.trim() : null,
    created_at_utc: isoDate(input.created_at_utc) ? input.created_at_utc : null,
    database_host: nonEmpty(input.database_host) ? input.database_host.trim().toLowerCase() : null,
    integrity_verified: input.integrity_verified === true,
    restore_procedure_id: nonEmpty(input.restore_procedure_id) ? input.restore_procedure_id.trim() : null,
    restore_tested_at_utc: isoDate(input.restore_tested_at_utc) ? input.restore_tested_at_utc : null,
    restore_result: input.restore_result === 'PASS' ? 'PASS' : null,
  };
  projection.valid = projection.schema_version === BACKUP_RECEIPT_SCHEMA
    && projection.backup_id !== null
    && projection.created_at_utc !== null
    && projection.database_host !== null
    && projection.integrity_verified
    && projection.restore_procedure_id !== null
    && projection.restore_tested_at_utc !== null
    && projection.restore_result === 'PASS';
  return Object.freeze(projection);
}

function check(code, ok, observed) {
  return Object.freeze({ code, ok: Boolean(ok), observed });
}

export function buildC1aPreflightReceipt({ facts = {}, now = () => new Date().toISOString() } = {}) {
  const repo = facts.repo || {};
  const environment = facts.environment || {};
  const worker = facts.worker || {};
  const backup = facts.backup || {};
  const controlPlane = facts.control_plane || {};
  const database = facts.database || {};
  const headSha = normalizeSha(repo.head_sha);
  const originMainSha = normalizeSha(repo.origin_main_sha);
  const configured = environment.configured || {};
  const service = worker.service || {};
  const timer = worker.timer || {};
  const unsafeGrants = finiteNumberOrNull(database.unsafe_grants);
  const rlsMissing = finiteNumberOrNull(database.rls_missing);
  const missingServiceAccess = finiteNumberOrNull(database.missing_service_access);

  const checks = [
    check('repo_required_path', repo.path === PRODUCTION_REPO, repo.path || null),
    check('repo_fresh_fetch', repo.fetch_ok === true, repo.fetch_ok === true),
    check('repo_clean', repo.clean === true, repo.clean === true),
    check('repo_exact_sha', headSha !== null && headSha === originMainSha, { head_sha: headSha, origin_main_sha: originMainSha }),
    check('protected_env_file', environment.exists === true
      && environment.owner === 'root'
      && ['600', '640'].includes(environment.mode)
      && environment.regular_file !== false
      && environment.symlink !== true,
    { exists: environment.exists === true, owner: environment.owner || null, mode: environment.mode || null }),
    check('required_runtime_config', REQUIRED_ENV_KEYS.every(key => configured[key] === true), configured),
    check('database_target_identity', nonEmpty(environment.supabase_host), environment.supabase_host || null),
    check('kill_switches_off', environment.kill_switches?.admission_enabled === false
      && environment.kill_switches?.model_calls_enabled === false
      && environment.kill_switches?.admission_literal === 'false'
      && environment.kill_switches?.model_calls_literal === 'false', environment.kill_switches || null),
    check('initial_service_off', SAFE_OFF_ENABLED_STATES.has(service.enabled)
      && SAFE_OFF_ACTIVE_STATES.has(service.active), service),
    check('initial_timer_off', SAFE_OFF_ENABLED_STATES.has(timer.enabled)
      && SAFE_OFF_ACTIVE_STATES.has(timer.active), timer),
    check('initial_worker_absent', worker.process_observed === true && worker.process_count === 0, {
      observed: worker.process_observed === true,
      process_count: worker.process_count ?? null,
    }),
    check('backup_restore_verified', backup.valid === true
      && backup.integrity_verified === true
      && backup.restore_result === 'PASS', {
      valid: backup.valid === true,
      backup_id: backup.backup_id || null,
      restore_procedure_id: backup.restore_procedure_id || null,
      restore_tested_at_utc: backup.restore_tested_at_utc || null,
      restore_result: backup.restore_result || null,
    }),
    check('backup_target_identity', nonEmpty(environment.supabase_host)
      && backup.database_host === environment.supabase_host, {
      environment_host: environment.supabase_host || null,
      backup_host: backup.database_host || null,
    }),
    check('control_plane_observed', controlPlane.observed === true
      && normalizeSha(controlPlane.sha) !== null
      && nonEmpty(controlPlane.version), {
      observed: controlPlane.observed === true,
      sha: normalizeSha(controlPlane.sha),
      version: nonEmpty(controlPlane.version) ? controlPlane.version : null,
    }),
    check('database_preflight', database.preflight_ok === true
      && MIGRATION_STATES.has(database.status)
      && unsafeGrants === 0
      && rlsMissing === 0
      && missingServiceAccess === 0, {
      preflight_ok: database.preflight_ok === true,
      status: database.status || null,
      migrations: database.migrations || null,
      unsafe_grants: unsafeGrants,
      rls_missing: rlsMissing,
      missing_service_access: missingServiceAccess,
      error_code: database.error_code || null,
    }),
  ];

  const ready = checks.every(item => item.ok);
  return Object.freeze({
    schema_version: 'agt002-initial-c1a-preflight-v1',
    generated_at_utc: now(),
    stage: 'C1A_E2_PRE_CHANGE',
    decision: ready ? 'READY_FOR_E2' : 'BLOCKED',
    authorizes: ready ? 'MIGRATIONS_099_104_AND_DEPLOY_FLAGS_OFF_ONLY' : 'NOTHING',
    canary_authorized: false,
    checks: Object.freeze(checks),
  });
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    // Managed executors can attach a supervisor EPERM marker even after the child
    // completed and returned a numeric status plus stdout. A numeric exit status is
    // therefore authoritative; a null status remains unobserved/fail-closed.
    ok: result.status === 0,
    error: result.status === null && result.error ? result.error.code || 'COMMAND_ERROR' : null,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function systemdState(action, unit) {
  const result = command('systemctl', [action, unit], { timeout: 10_000 });
  const output = `${result.stdout}\n${result.stderr}`.trim().toLowerCase();
  if (/failed to connect to bus|operation not permitted|permission denied/.test(output)) return 'unobserved';
  if (/not-found|could not be found|no such file/.test(output)) return 'not-found';
  const first = result.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean);
  return first || (result.ok ? 'unknown' : 'unobserved');
}

function readEnvironmentFacts(path) {
  try {
    const stat = lstatSync(path);
    const parsed = parseProtectedEnv(readFileSync(path, 'utf8'));
    return {
      exists: true,
      owner: stat.uid === 0 ? 'root' : String(stat.uid),
      mode: (stat.mode & 0o777).toString(8),
      regular_file: stat.isFile(),
      symlink: stat.isSymbolicLink(),
      ...sanitizeInitialEnvironment(parsed),
    };
  } catch {
    return {
      exists: false,
      owner: null,
      mode: null,
      regular_file: false,
      symlink: false,
      ...sanitizeInitialEnvironment({}),
    };
  }
}

function readBackupFacts(path) {
  if (!nonEmpty(path)) return validateBackupReceipt({});
  try {
    return validateBackupReceipt(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return validateBackupReceipt({});
  }
}

async function readControlPlane(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    const body = await response.json();
    return {
      observed: response.ok,
      sha: normalizeSha(body?.sha),
      version: nonEmpty(body?.version) ? body.version : null,
    };
  } catch {
    return { observed: false, sha: null, version: null };
  }
}

function readDatabaseFacts(repoPath, envPath) {
  const result = command(process.execPath, ['scripts/agt002-initial-analysis-migrations.mjs', 'preflight'], {
    cwd: repoPath,
    timeout: 60_000,
    env: { ...process.env, ENV_FILE: envPath },
  });
  const stateMatch = result.stdout.match(/^STATE (\{.*\})$/m);
  let state = null;
  try { state = stateMatch ? JSON.parse(stateMatch[1]) : null; } catch { state = null; }
  const marker = `${result.stdout}\n${result.stderr}`.match(/AGT002_[A-Z0-9_]+|RUNNER_FAILED/)?.[0]
    || (result.status === null ? 'RUNNER_UNOBSERVED' : (result.status === 0 ? null : `RUNNER_EXIT_${result.status}`));
  return {
    preflight_ok: result.ok && /(^|\n)PREFLIGHT_OK(\n|$)/.test(result.stdout),
    status: state?.status || null,
    migrations: state?.migrations || null,
    unsafe_grants: state?.unsafe_grants ?? null,
    rls_missing: state?.rls_missing ?? null,
    missing_service_access: state?.missing_service_access ?? null,
    error_code: marker,
  };
}

export async function collectC1aPreflightFacts({
  repoPath = PRODUCTION_REPO,
  envPath = PRODUCTION_ENV_FILE,
  backupReceiptPath = process.env.AGT002_C1A_BACKUP_RECEIPT_FILE,
  controlPlaneUrl = CONTROL_PLANE_URL,
} = {}) {
  const fetchResult = command('git', ['-C', repoPath, 'fetch', 'origin', 'main'], { timeout: 60_000 });
  const status = command('git', ['-C', repoPath, 'status', '--porcelain']);
  const head = command('git', ['-C', repoPath, 'rev-parse', 'HEAD']);
  const originMain = command('git', ['-C', repoPath, 'rev-parse', 'origin/main']);
  const processes = command('pgrep', ['-f', 'run-agt002-initial-analysis-worker.mjs']);
  const environment = readEnvironmentFacts(envPath);
  const [controlPlane, database] = await Promise.all([
    readControlPlane(controlPlaneUrl),
    Promise.resolve(readDatabaseFacts(repoPath, envPath)),
  ]);
  return {
    repo: {
      path: resolve(repoPath),
      fetch_ok: fetchResult.ok,
      clean: status.ok && status.stdout === '',
      head_sha: head.ok ? head.stdout : null,
      origin_main_sha: originMain.ok ? originMain.stdout : null,
    },
    environment,
    worker: {
      service: {
        enabled: systemdState('is-enabled', INITIAL_SERVICE),
        active: systemdState('is-active', INITIAL_SERVICE),
      },
      timer: {
        enabled: systemdState('is-enabled', INITIAL_TIMER),
        active: systemdState('is-active', INITIAL_TIMER),
      },
      process_observed: processes.status === 0 || processes.status === 1,
      process_count: processes.status === 0 && processes.stdout
        ? processes.stdout.split(/\r?\n/).filter(Boolean).length
        : (processes.status === 1 ? 0 : null),
    },
    backup: readBackupFacts(backupReceiptPath),
    control_plane: controlPlane,
    database,
  };
}

async function main() {
  const unexpected = process.argv.slice(2);
  if (unexpected.length > 0) throw new Error('Use AGT002_C1A_BACKUP_RECEIPT_FILE; este preflight no acepta argumentos libres.');
  const facts = await collectC1aPreflightFacts();
  const receipt = buildC1aPreflightReceipt({ facts });
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.decision !== 'READY_FOR_E2') process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch(() => {
    console.error(JSON.stringify({
      schema_version: 'agt002-initial-c1a-preflight-v1',
      decision: 'BLOCKED',
      authorizes: 'NOTHING',
      canary_authorized: false,
      error_code: 'C1A_PREFLIGHT_INTERNAL_FAILURE',
    }));
    process.exitCode = 1;
  });
}
