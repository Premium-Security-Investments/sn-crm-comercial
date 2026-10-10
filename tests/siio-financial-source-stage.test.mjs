import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageFinancialSource } from '../siio-financial-source-stage.js';
import { FinancialConnectorError } from '../siio-financial-connectors.js';

const source = { id: 'finanzas-drive', provider: 'google_drive', enabled: true, fileId: 'file12345', auth: { type: 'access_token', tokenEnv: 'TEST_TOKEN' } };
const options = { periodMonth: '2026-04-01', cutoffDate: '2026-04-15' };
const snapshot = (hash = 'a', cutoff = options.cutoffDate) => ({ source_id: source.id, provider: source.provider, format: 'workbook', content_sha256: hash.repeat(64), period_month: options.periodMonth, cutoff_date: cutoff, status: 'listo_revision', provenance: { file_id: 'file12345', revision: '1' }, validations: [], payload: { structure: { sheets: [{ name: 'PYG NIIF', state: 'visible', dimension: 'A1:J60' }] }, metrics: [] } });
async function sandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siio-financial-stage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('staging preserves immutable cuts, protects files, records runs and does not falsely advance unchanged data', async t => {
  const outputDir = await sandbox(t);
  const first = await stageFinancialSource(source, { ...options, outputDir, readSource: async () => snapshot() });
  const directory = path.join(outputDir, source.id);
  const original = await readFile(path.join(directory, first.snapshot), 'utf8');
  assert.equal(first.outcome, 'staged');
  assert.equal(first.publication, 'not_published');
  assert.equal((await stat(path.join(directory, first.snapshot))).mode & 0o777, 0o600);
  const duplicate = await stageFinancialSource(source, { ...options, cutoffDate: '2026-04-16', outputDir, readSource: async () => snapshot('a', '2026-04-16') });
  assert.equal(duplicate.outcome, 'unchanged');
  assert.equal(duplicate.requested_cutoff, '2026-04-16');
  assert.equal(duplicate.effective_cutoff, '2026-04-15');
  assert.equal(await readFile(path.join(directory, first.snapshot), 'utf8'), original);
  const updated = await stageFinancialSource(source, { ...options, cutoffDate: '2026-04-16', outputDir, readSource: async () => snapshot('b', '2026-04-16') });
  assert.equal(updated.outcome, 'staged');
  assert.notEqual(updated.snapshot, first.snapshot);
  assert.equal((await readdir(path.join(directory, 'runs'))).length, 3);
});
test('staging failures preserve checkpoint and write sanitized durable errors', async t => {
  const outputDir = await sandbox(t);
  await stageFinancialSource(source, { ...options, outputDir, readSource: async () => snapshot() });
  const directory = path.join(outputDir, source.id);
  const checkpoint = await readFile(path.join(directory, 'checkpoint.json'), 'utf8');
  await assert.rejects(stageFinancialSource(source, { ...options, outputDir, readSource: async () => { throw new Error('private-token-and-financial-data'); } }), { code: 'SOURCE_STAGE_FAILED' });
  assert.equal(await readFile(path.join(directory, 'checkpoint.json'), 'utf8'), checkpoint);
  const receipt = await readFile(path.join(directory, 'last-run.json'), 'utf8');
  assert.ok(!receipt.includes('private-token'));
  assert.equal(JSON.parse(receipt).outcome, 'failed');
  await assert.rejects(stageFinancialSource(source, { ...options, outputDir, readSource: async () => { throw new FinancialConnectorError('SOURCE_CHANGED_DURING_READ'); } }), { code: 'SOURCE_CHANGED_DURING_READ' });
  assert.ok(!(await readdir(directory)).includes('.sync-lock'));
});
test('staging serializes concurrent jobs for the same source without deleting another job lock', async t => {
  const outputDir = await sandbox(t);
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = stageFinancialSource(source, { ...options, outputDir, readSource: async () => { entered(); await waiting; return snapshot(); } });
  await started;
  await assert.rejects(stageFinancialSource(source, { ...options, outputDir, readSource: async () => snapshot('b') }), { code: 'SOURCE_SYNC_ALREADY_RUNNING' });
  assert.ok((await readdir(path.join(outputDir, source.id))).includes('.sync-lock'));
  release(); await first;
});
test('structure changes are retained as review warnings in the new snapshot', async t => {
  const outputDir = await sandbox(t);
  await stageFinancialSource(source, { ...options, outputDir, readSource: async () => snapshot() });
  const altered = snapshot('b'); altered.payload.structure.sheets[0].dimension = 'A1:J90';
  const result = await stageFinancialSource(source, { ...options, outputDir, readSource: async () => altered });
  const stored = JSON.parse(await readFile(path.join(outputDir, source.id, result.snapshot), 'utf8'));
  assert.equal(stored.structure_diff.changed, true);
  assert.equal(stored.validations.at(-1).rule, 'ESTRUCTURA_CAMBIO_ENTRE_VERSIONES');
});
