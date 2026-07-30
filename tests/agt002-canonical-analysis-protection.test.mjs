import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { getLatestAgt002AnalysisAttempt } from '../agt002-preview-persistence.js';
import { getCurrentTenderAnalysis } from '../tender-analysis-foundation.js';

const ids = {
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '55555555-5555-4555-8555-555555555555',
  canonicalRun: '66666666-6666-4666-8666-666666666666',
};

function createDatabase() {
  const tables = {
    psi_tender_document_state: [{ opportunity_id: ids.opportunity, current_snapshot_id: ids.snapshot, refresh_in_progress: false }],
    psi_tender_document_snapshots: [{ id: ids.snapshot, opportunity_id: ids.opportunity, document_hash: 'document-hash' }],
    psi_tender_analysis_runs: [
      { id: ids.canonicalRun, opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true, result: { recommendation: 'pause' }, created_at: '2026-07-29T10:00:00.000Z', completed_at: '2026-07-29T10:01:00.000Z' },
      { id: '77777777-7777-4777-8777-777777777777', opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed', canonical: false, result: { recommendation: 'advance' }, created_at: '2026-07-29T10:02:00.000Z' },
      { id: '88888888-8888-4888-8888-888888888888', opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'failed', canonical: false, result: null, created_at: '2026-07-29T10:03:00.000Z' },
    ],
    psi_agt002_analysis_attempt_events: [
      { id: '99999999-9999-4999-8999-999999999991', opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, tender_id: ids.tender, attempt_key: 'retry-1', producer: 'AGT-002', state: 'running', error_code: null, error_message: null, analysis_run_id: null, created_at: '2026-07-29T10:03:00.000Z' },
      { id: '99999999-9999-4999-8999-999999999992', opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, tender_id: ids.tender, attempt_key: 'retry-1', producer: 'AGT-002', state: 'unavailable', error_code: 'AGT002_UNAVAILABLE', error_message: 'provider leaked sk-secret-that-must-not-be-returned', analysis_run_id: null, created_at: '2026-07-29T10:04:00.000Z' },
    ],
  };
  return {
    from(table) {
      const filters = [];
      const materialize = () => (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
      const chain = {
        select() { return chain; },
        eq(key, value) { filters.push([key, value]); return chain; },
        order() { return chain; },
        maybeSingle() { return Promise.resolve({ data: materialize()[0] || null, error: null }); },
        limit(count) {
          const data = materialize().slice().sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')) || String(right.id).localeCompare(String(left.id))).slice(0, count);
          return Promise.resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
}

const database = createDatabase();
const current = await getCurrentTenderAnalysis(database, ids.opportunity, null, { canonicalOnly: true });
assert.equal(current.run_id, ids.canonicalRun, 'later rules and failed retries must not replace the completed canonical run');
assert.equal(current.canonical, true);
assert.equal(current.status, 'completed');

const latestAttempt = await getLatestAgt002AnalysisAttempt(database, ids.opportunity, { snapshotId: ids.snapshot });
assert.deepEqual(latestAttempt, {
  event_id: '99999999-9999-4999-8999-999999999992',
  snapshot_id: ids.snapshot,
  tender_id: ids.tender,
  attempt_key: 'retry-1',
  producer: 'AGT-002',
  state: 'unavailable',
  error_code: 'AGT002_UNAVAILABLE',
  analysis_run_id: null,
  created_at: '2026-07-29T10:04:00.000Z',
});
assert.doesNotMatch(JSON.stringify(latestAttempt), /sk-secret|provider leaked/, 'latest-attempt presentation must not expose raw provider messages');

for (const relative of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /getLatestAgt002AnalysisAttempt/, `${relative} must load the latest canonical attempt`);
  const records = source.match(/async function getTenderDocumentRecords[\s\S]*?\n}\n\n/)?.[0] || '';
  assert.match(records, /const latestAnalysisAttempt = canonicalOnly \? await getLatestAgt002AnalysisAttempt\(database, opportunityId\) : null/, `${relative} must load the latest attempt only in canonical mode`);
  assert.match(records, /analysis_attempt: latestAnalysisAttempt/, `${relative} must expose latest attempt separately from analysis`);
}

console.log('AGT-002 canonical analysis protection passed');
