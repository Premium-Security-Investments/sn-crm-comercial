// AGT-002 migration 105 — the authorized admission RPC must reach pgcrypto by schema-qualified
// name. 104 called digest() unqualified while declaring `search_path = public, pg_temp`; pgcrypto
// lives in the `extensions` schema, so the call resolved to nothing and every admission failed
// with SQLSTATE 42883 (undefined_function), making it impossible to create any INITIAL job. The
// defect was observed in production during the E4 canary for FTIC-LP-003-2026 on 2026-10-05.
//
// This guard is deliberately stated over EVERY migration that defines the admission RPC, so a
// later migration cannot reintroduce the unqualified call.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { MIGRATION_ORDER } from '../scripts/agt002-initial-analysis-migrations.mjs';

const fn = 'psi_admit_authorized_agt002_initial_analysis_job';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const migrationPath = new URL('105_agt002_initial_admission_digest_schema_qualification.sql', migrationsDir);
const rollbackPath = new URL('../supabase/rollbacks/105_agt002_initial_admission_digest_schema_qualification_rollback.sql', import.meta.url);

const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');

// --- 105 is registered in the governed runner chain -------------------------------------------
assert.ok(MIGRATION_ORDER.includes('105'), '105 must be part of the governed migration chain');
assert.equal(MIGRATION_ORDER[MIGRATION_ORDER.length - 1], '105', '105 must be the last slot in the chain');

// --- 105 shape --------------------------------------------------------------------------------
assert.match(migration, /^--/, '105 must open with its rationale');
assert.match(migration, /begin;/i);
assert.match(migration, /commit;\s*$/i);
assert.ok(migration.includes(`create or replace function public.${fn}(`), `105 must redefine public.${fn}`);
assert.match(migration, /security definer/i);
assert.match(migration, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
  '105 must keep the hardened search_path rather than widening it');
assert.match(migration, /revoke all on function public\.psi_admit_authorized_agt002_initial_analysis_job/i,
  '105 must preserve the revoke of the admission RPC');
assert.match(migration, /grant execute on function public\.psi_admit_authorized_agt002_initial_analysis_job[^;]*to service_role/i,
  '105 must preserve service_role execute on the admission RPC');

// --- the actual regression --------------------------------------------------------------------
const unqualifiedDigest = /(^|[^.\w])digest\s*\(/;

// The guard must read SQL, not prose: these files explain the defect in their header comments,
// which legitimately name digest() as the thing that was wrong.
const sqlOnly = sql => sql.replace(/--[^\n]*/g, '');

assert.ok(migration.includes('extensions.digest('),
  '105 must call pgcrypto as extensions.digest(...)');
assert.equal(unqualifiedDigest.test(sqlOnly(migration).replace(/extensions\.digest\s*\(/g, 'QUALIFIED(')), false,
  '105 must not contain any unqualified digest( call');

// Every digest call in the migration must be schema-qualified, and there must be one per batch
// phase: the member batches and the synthesis topology.
const qualifiedCalls = sqlOnly(migration).match(/extensions\.digest\s*\(/g) ?? [];
assert.equal(qualifiedCalls.length, 2,
  '105 must qualify both request-hash digests (member_batch_analysis and synthesis)');
assert.match(migration, /member_batch_analysis/, '105 must preserve the member batch phase');
assert.match(migration, /synthesis/, '105 must preserve the synthesis phase');

// --- rollback is fail-closed ------------------------------------------------------------------
assert.match(rollback, /begin;/i);
assert.match(rollback, /commit;\s*$/i);
assert.match(rollback, /lock table public\.psi_agt002_initial_analysis_jobs in access exclusive mode/i,
  'rollback 105 must take the jobs table lock before inspecting evidence');
assert.match(rollback, /Rollback 105 refused/i,
  'rollback 105 must refuse while admitted INITIAL job evidence exists');
assert.match(rollback, /errcode\s*=\s*'55000'/i, 'rollback 105 must fail closed with 55000');

// --- no other migration in the chain reintroduces the defect -----------------------------------
const chainFiles = readdirSync(migrationsDir)
  .filter(name => /^\d{3}_.*\.sql$/.test(name))
  .filter(name => {
    const sql = readFileSync(new URL(name, migrationsDir), 'utf8');
    return sql.includes(`function public.${fn}(`);
  });

assert.ok(chainFiles.length >= 2, 'expected 103/104 plus the 105 correction to define the admission RPC');

const latest = chainFiles.sort().at(-1);
assert.equal(latest, '105_agt002_initial_admission_digest_schema_qualification.sql',
  'the last migration defining the admission RPC must be the corrected one');

const latestSql = readFileSync(new URL(latest, migrationsDir), 'utf8');
assert.equal(unqualifiedDigest.test(sqlOnly(latestSql).replace(/extensions\.digest\s*\(/g, 'QUALIFIED(')), false,
  'the effective admission RPC definition must never call digest() unqualified');
