import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AGT002_REANALYSIS_STATUS_FIELDS, presentAgt002ReanalysisStatus } from '../agt002-reanalysis-api.js';

const expectedFields = ['job_id', 'status', 'created_at', 'started_at', 'completed_at', 'analysis_run_id', 'error_code'];
assert.deepEqual([...AGT002_REANALYSIS_STATUS_FIELDS], expectedFields);
const presented = presentAgt002ReanalysisStatus({
  jobId: 'job-1', status: 'unavailable', opportunityId: 'secret-scope', snapshotId: 'snapshot',
  contextVersionId: 'context', frozenEngineInput: { private: true }, errorMessage: 'raw provider text',
  createdAt: 'c', startedAt: 's', completedAt: 'd', analysisRunId: null, errorCode: 'timeout', updatedAt: 'u',
});
assert.deepEqual(Object.keys(presented), expectedFields);
assert.equal(presented.error_code, 'timeout');
assert.equal('error_message' in presented, false);
assert.equal('frozen_engine_input' in presented, false);

const root = path.resolve(import.meta.dirname, '..');
for (const relative of ['server/index.js', 'api/[...path].js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const start = source.indexOf("app.get('/api/agt002-reanalysis-status'");
  const end = source.indexOf("\napp.", start + 10);
  assert.ok(start >= 0, `${relative} must expose the status route`);
  const route = source.slice(start, end < 0 ? source.length : end);
  assert.match(route, /getAuthContext\(req\)/);
  assert.match(route, /requireAction\(currentProfile, ACTIONS\.AI_ANALYSIS_RUN\)/);
  assert.match(route, /ensureTenderOpportunity\(database, opportunityId, currentProfile\)/);
  assert.doesNotMatch(route, /ensureOpportunityAccess\(database, opportunityId, currentProfile\)/);
  assert.match(route, /presentAgt002ReanalysisStatus/);
  assert.doesNotMatch(route, /frozen_engine_input|error_message|context_version_id|snapshot_id/);
}

const adapter = fs.readFileSync(path.join(root, 'agt002-reanalysis-jobs.js'), 'utf8');
const latestStart = adapter.indexOf('export async function findLatestAgt002ReanalysisStatusForOpportunity');
const latestEnd = adapter.indexOf('\n}', latestStart) + 2;
const latest = adapter.slice(latestStart, latestEnd);
assert.match(latest, /id,status,created_at,started_at,completed_at,analysis_run_id,error_code/);
assert.doesNotMatch(latest, /frozen_engine_input|error_message/);

console.log('AGT-002 status allowlist and authorization contract passed');
