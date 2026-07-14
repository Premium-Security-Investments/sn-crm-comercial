import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/016_siio_initial_executive_snapshot_seed.sql', import.meta.url), 'utf8');
const sourceSeed = sql.indexOf('insert into public.siio_sources');
const financialSeed = sql.indexOf('insert into public.siio_financial_metrics');
const payrollSeed = sql.indexOf('insert into public.siio_payroll_aggregates');

assert.ok(sourceSeed >= 0, 'Migration 016 must create/upsert its source dependencies');
assert.ok(sourceSeed < financialSeed, 'Source dependencies must exist before financial metrics');
assert.ok(sourceSeed < payrollSeed, 'Source dependencies must exist before payroll aggregates');

const sourceBlock = sql.slice(sourceSeed, financialSeed);
for (const id of ['SRC-011', 'SRC-012', 'SRC-013']) {
  assert.ok(sourceBlock.includes(`'${id}'`), `Migration 016 must seed ${id}`);
}
assert.match(sourceBlock, /on conflict \(id\) do update set/i, 'Source seed must be idempotent');

console.log('SIIO migration source dependency contract OK');
