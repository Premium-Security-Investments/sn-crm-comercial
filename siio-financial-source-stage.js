import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compareFinancialStructures } from './siio-financial-workbook.js';
import { FinancialConnectorError, readFinancialSource, validateFinancialSource } from './siio-financial-connectors.js';

async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function replaceJson(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
// This stage is deliberately independent of profiles/RPCs: it cannot validate or
// publish a human cut, write to the ERP, or impersonate an uploader in SIIO.
export async function stageFinancialSource(source, { outputDir, now = () => new Date().toISOString(), readSource = readFinancialSource, ...options } = {}) {
  validateFinancialSource(source);
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw new FinancialConnectorError('ABSOLUTE_OUTPUT_DIRECTORY_REQUIRED');
  const directory = path.join(outputDir, source.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.sync-lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new FinancialConnectorError('SOURCE_SYNC_ALREADY_RUNNING'); throw error; }
  const startedAt = now();
  const runId = randomUUID();
  const runs = path.join(directory, 'runs');
  try {
    await mkdir(runs, { recursive: true, mode: 0o700 });
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ run_id: runId, pid: process.pid, started_at: startedAt }), { mode: 0o600 });
    const result = await readSource(source, options);
    if (result.source_id !== source.id || !/^[a-f0-9]{64}$/.test(result.content_sha256) || result.period_month !== options.periodMonth || result.cutoff_date !== options.cutoffDate) throw new FinancialConnectorError('INVALID_SOURCE_SNAPSHOT');
    const last = await json(path.join(directory, 'checkpoint.json'));
    // The same bytes at a later requested cutoff must not be relabelled as fresh.
    const duplicate = last?.content_sha256 === result.content_sha256;
    let snapshot = last?.snapshot;
    if (!duplicate) {
      snapshot = `${result.period_month}_${result.cutoff_date}_${result.content_sha256}.json`;
      const structureDiff = result.format === 'workbook' ? compareFinancialStructures(last?.structure || null, result.payload.structure) : null;
      const stored = { ...result, fetched_at: now(), run_id: runId, structure_diff: structureDiff };
      if (structureDiff?.changed) stored.validations = [...stored.validations, { rule: 'ESTRUCTURA_CAMBIO_ENTRE_VERSIONES', severity: 'advertencia', ok: false }];
      try { await writeFile(path.join(directory, snapshot), `${JSON.stringify(stored, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await json(path.join(directory, snapshot));
        if (existing?.content_sha256 !== result.content_sha256 || existing?.source_id !== source.id || existing?.cutoff_date !== result.cutoff_date) throw new FinancialConnectorError('SNAPSHOT_CONFLICT');
      }
      await replaceJson(path.join(directory, 'checkpoint.json'), { snapshot, content_sha256: result.content_sha256, cutoff_date: result.cutoff_date, period_month: result.period_month, structure: result.payload.structure || null, status: result.status });
    }
    const receipt = { run_id: runId, source_id: source.id, provider: source.provider, started_at: startedAt, finished_at: now(), outcome: duplicate ? 'unchanged' : 'staged', snapshot, content_sha256: result.content_sha256, provenance: result.provenance, requested_cutoff: result.cutoff_date, effective_cutoff: duplicate ? last.cutoff_date : result.cutoff_date, status: duplicate ? last.status : result.status, publication: 'not_published' };
    await writeFile(path.join(runs, `${runId}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await replaceJson(path.join(directory, 'last-run.json'), receipt);
    return receipt;
  } catch (error) {
    const receipt = { run_id: runId, source_id: source.id, provider: source.provider, started_at: startedAt, finished_at: now(), outcome: 'failed', error_code: error instanceof FinancialConnectorError ? error.code : 'SOURCE_STAGE_FAILED', publication: 'not_published' };
    // Never log raw remote errors, URLs, tokens or financial rows.
    await writeFile(path.join(runs, `${runId}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await replaceJson(path.join(directory, 'last-run.json'), receipt);
    throw new FinancialConnectorError(receipt.error_code);
  } finally { await rm(lock, { recursive: true, force: true }); }
}
