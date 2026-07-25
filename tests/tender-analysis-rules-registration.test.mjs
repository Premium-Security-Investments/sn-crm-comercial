import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  buildTenderSnapshotInput,
  getCurrentTenderAnalysis,
  presentCurrentTenderAnalysis,
  registerSiioRulesAnalysis,
} from '../tender-analysis-foundation.js';

const ids = {
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  actor: '44444444-4444-4444-8444-444444444444',
  snapshot: '55555555-5555-4555-8555-555555555555',
  run: '66666666-6666-4666-8666-666666666666',
};

const documents = [
  {
    id: 'b', name: 'B', document_type: 'pliego', extracted_text: 'línea uno\r\nlínea dos\rfin',
    signed_url: 'https://private.example/b', uploaded_at: '2026-07-24T10:00:00.000Z', interaction_id: 'first', uploaded_by: 'Ana', current: true,
  },
  {
    id: 'a', name: 'A', document_type: 'anexo_tecnico', extracted_text: 'anexo',
    signed_url: 'https://private.example/a', uploaded_at: '2026-07-24T10:00:00.000Z', interaction_id: 'first', uploaded_by: 'Ana', current: true,
  },
];

const left = buildTenderSnapshotInput(documents, { version: 1, nested: { z: 'z', a: 'a' } });
const right = buildTenderSnapshotInput([...documents].reverse(), { nested: { a: 'a', z: 'z' }, version: 1 });
assert.equal(left.document_hash, right.document_hash);
assert.equal(left.profile_hash, right.profile_hash);
assert.deepEqual(left.documents, [
  { document_id: 'a', name: 'A', document_type: 'anexo_tecnico', content: 'anexo', content_sha256: 'be9ae4ef7a2251bda1b46cbf7d43acb2ccee6cb1cefab613eb4e38f45336bd04', current: true },
  { document_id: 'b', name: 'B', document_type: 'pliego', content: 'línea uno\nlínea dos\nfin', content_sha256: '45a4934a5c9236ba587cde5e212ae8eb3c9d40c57b26a0f23be57445297df74d', current: true },
]);
assert.deepEqual(left.company_profile, { nested: { a: 'a', z: 'z' }, version: 1 });

const reimportedDocuments = [
  { ...documents[0], uploaded_at: '2026-07-25T10:00:00.000Z', interaction_id: 'second', uploaded_by: 'Beto', signed_url: 'https://other.example/b' },
  { ...documents[1], uploaded_at: '2026-07-25T10:00:00.000Z', interaction_id: 'second', uploaded_by: 'Beto', signed_url: 'https://other.example/a' },
  ...documents,
];
const reimported = buildTenderSnapshotInput(reimportedDocuments, { version: 1, nested: { a: 'a', z: 'z' } });
assert.equal(reimported.document_hash, left.document_hash, 'unchanged re-import metadata must not change the semantic manifest');
assert.deepEqual(reimported.documents, left.documents);

const changedContent = buildTenderSnapshotInput([
  ...documents,
  { ...documents[0], extracted_text: 'línea actualizada', uploaded_at: '2026-07-26T10:00:00.000Z', interaction_id: 'third' },
], { version: 1, nested: { a: 'a', z: 'z' } });
assert.notEqual(changedContent.document_hash, left.document_hash);
assert.equal(changedContent.documents.filter(document => document.document_id === 'b').length, 1);
assert.equal(changedContent.documents.find(document => document.document_id === 'b').content, 'línea actualizada');

const fallbackIdentity = buildTenderSnapshotInput([
  { source_document_id: 'source-1', name: 'Source', document_type: 'pliego', extracted_text: 'source text' },
  { id: '   ', source_document_id: 'source-2', name: 'Blank ID', document_type: 'pliego', extracted_text: 'source fallback text' },
  { name: 'No ID', document_type: 'otro', extracted_text: 'identity text' },
], {});
assert.equal(fallbackIdentity.documents.find(document => document.name === 'Source').document_id, 'source-1');
assert.equal(fallbackIdentity.documents.find(document => document.name === 'Blank ID').document_id, 'source-2');
assert.match(fallbackIdentity.documents.find(document => document.name === 'No ID').document_id, /^[a-f0-9]{64}$/);

function createSemanticReplayDatabase() {
  let snapshot = null;
  let run = null;
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_record_tender_document_snapshot') {
        const semanticSnapshot = {
          opportunity_id: params.p_opportunity_id,
          tender_id: params.p_tender_id,
          document_hash: params.p_document_hash,
          profile_hash: params.p_profile_hash,
          document_manifest: params.p_document_manifest,
          profile_snapshot: params.p_profile_snapshot,
        };
        if (snapshot) assert.deepEqual(semanticSnapshot, snapshot, 'snapshot replay must be semantically identical');
        else snapshot = semanticSnapshot;
        return { data: { id: ids.snapshot }, error: null };
      }
      if (name === 'psi_record_tender_analysis_run') {
        const semanticRun = {
          snapshot_id: params.p_snapshot_id,
          opportunity_id: params.p_opportunity_id,
          tender_id: params.p_tender_id,
          producer: params.p_producer,
          method: params.p_method,
          status: params.p_status,
          result: params.p_result,
          critical_open_count: params.p_critical_open_count,
          idempotency_key: params.p_idempotency_key,
          schema_version: params.p_schema_version,
          policy_version: params.p_policy_version,
          model: params.p_model,
          usage: params.p_usage,
        };
        if (run) assert.deepEqual(semanticRun, run, 'run replay must be semantically identical');
        else run = semanticRun;
        return { data: { id: ids.run, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed', critical_open_count: params.p_critical_open_count }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

const database = createSemanticReplayDatabase();
const firstPresentationResult = {
  recommendation: 'GO condicionado', generated_at: '2026-07-24T10:00:00.000Z',
  nested: { generated_at: 'must remain semantic' }, questions: [{ critical: true }],
};
const secondPresentationResult = { ...firstPresentationResult, generated_at: '2026-07-24T10:00:01.000Z' };
const firstRegistered = await registerSiioRulesAnalysis(database, {
  opportunity_id: ids.opportunity, tender_id: ids.tender, actor_id: ids.actor,
  documents, company_profile: { version: 1 }, result: firstPresentationResult,
});
const secondRegistered = await registerSiioRulesAnalysis(database, {
  opportunity_id: ids.opportunity, tender_id: ids.tender, actor_id: ids.actor,
  documents: reimportedDocuments, company_profile: { version: 1 }, result: secondPresentationResult,
});
assert.equal(firstRegistered.run_id, ids.run);
assert.equal(firstRegistered.snapshot_id, ids.snapshot);
assert.equal(firstRegistered.producer, 'siio_rules_v1');
assert.equal(firstRegistered.method, 'rules');
assert.equal(firstRegistered.status, 'completed');
assert.equal(firstRegistered.current, true);
assert.deepEqual(firstRegistered.result, { recommendation: 'GO condicionado', nested: { generated_at: 'must remain semantic' }, questions: [{ critical: true }] });
assert.deepEqual(secondRegistered.result, firstRegistered.result);
assert.equal(firstPresentationResult.generated_at, '2026-07-24T10:00:00.000Z', 'canonicalization must not mutate the legacy presentation result');
assert.deepEqual(database.calls.map(call => call.name), [
  'psi_record_tender_document_snapshot', 'psi_record_tender_analysis_run',
  'psi_record_tender_document_snapshot', 'psi_record_tender_analysis_run',
]);
const firstRunPayload = database.calls[1].params;
const secondRunPayload = database.calls[3].params;
assert.equal(firstRunPayload.p_producer, 'siio_rules_v1');
assert.equal(firstRunPayload.p_method, 'rules');
assert.equal(firstRunPayload.p_status, 'completed');
assert.equal(firstRunPayload.p_policy_version, 'siio-rules-v1');
assert.equal(firstRunPayload.p_model, null);
assert.deepEqual(firstRunPayload.p_usage, { input_tokens: 0, output_tokens: 0, cost_usd: 0 });
assert.equal(firstRunPayload.p_critical_open_count, 1);
assert.match(firstRunPayload.p_idempotency_key, /^[0-9a-f]{64}$/);
assert.deepEqual(secondRunPayload.p_result, firstRunPayload.p_result);
assert.equal(secondRunPayload.p_idempotency_key, firstRunPayload.p_idempotency_key);
assert.equal(firstRunPayload.p_result.generated_at, undefined);

const failedDatabase = { async rpc() { return { data: null, error: { message: 'RPC unavailable' } }; } };
await assert.rejects(() => registerSiioRulesAnalysis(failedDatabase, {
  opportunity_id: ids.opportunity, tender_id: ids.tender, actor_id: ids.actor, documents, company_profile: {}, result: firstPresentationResult,
}), /RPC unavailable/);

function createCurrentAnalysisDatabase({ latestSnapshot, runs }) {
  const queries = [];
  return {
    queries,
    from(table) {
      const filters = [];
      const chain = {
        select() { return chain; },
        eq(key, value) { filters.push([key, value]); return chain; },
        order() { return chain; },
        limit() {
          queries.push({ table, filters: [...filters] });
          if (table === 'psi_tender_document_snapshots') return Promise.resolve({ data: latestSnapshot ? [latestSnapshot] : [], error: null });
          const matching = runs.filter(run => Object.entries(Object.fromEntries(filters)).every(([key, value]) => run[key] === value));
          return Promise.resolve({ data: matching.slice().sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))).slice(0, 1), error: null });
        },
      };
      return chain;
    },
  };
}

const currentResult = { recommendation: 'GO condicionado', questions: [{ critical: true }] };
const currentSnapshot = { id: '77777777-7777-4777-8777-777777777777', document_hash: buildTenderSnapshotInput(documents, {}).document_hash };
const currentDatabase = createCurrentAnalysisDatabase({
  latestSnapshot: currentSnapshot,
  runs: [
    { id: 'old-run', opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed', result: { recommendation: 'old' }, critical_open_count: 0, created_at: '2026-07-24T12:00:00.000Z' },
    { id: ids.run, opportunity_id: ids.opportunity, snapshot_id: currentSnapshot.id, producer: 'siio_rules_v1', method: 'rules', status: 'completed', result: currentResult, critical_open_count: 1, created_at: '2026-07-24T11:00:00.000Z' },
  ],
});
const current = await getCurrentTenderAnalysis(currentDatabase, ids.opportunity);
assert.equal(current.run_id, ids.run, 'a late old-snapshot run must not hide the current-snapshot run');
assert.equal(current.snapshot_id, currentSnapshot.id);
assert.equal(current.current, true);
assert.deepEqual(current.result, currentResult);
assert.deepEqual(currentDatabase.queries[1].filters, [
  ['opportunity_id', ids.opportunity],
  ['snapshot_id', currentSnapshot.id],
]);
const stillCurrent = await getCurrentTenderAnalysis(currentDatabase, ids.opportunity, reimportedDocuments);
assert.equal(stillCurrent.current, true, 'reimportar el mismo contenido no invalida el análisis');
const changedDocuments = documents.map((document, index) => index === 0 ? { ...document, content: `${document.content} ADENDA` } : document);
const staleAfterRefresh = await getCurrentTenderAnalysis(currentDatabase, ids.opportunity, changedDocuments);
assert.equal(staleAfterRefresh.current, false, 'cambiar los documentos actuales debe conservar pero marcar desactualizado el análisis previo');

const noSnapshotDatabase = createCurrentAnalysisDatabase({ latestSnapshot: null, runs: [] });
assert.equal(await getCurrentTenderAnalysis(noSnapshotDatabase, ids.opportunity), null);
assert.equal(noSnapshotDatabase.queries.length, 1);
const noCurrentRunDatabase = createCurrentAnalysisDatabase({ latestSnapshot: currentSnapshot, runs: [{ id: 'failed', opportunity_id: ids.opportunity, snapshot_id: currentSnapshot.id, producer: 'AGT-002', method: 'agent_ai', status: 'failed', result: null, critical_open_count: 0, created_at: '2026-07-24T13:00:00.000Z' }] });
const failedCurrent = await getCurrentTenderAnalysis(noCurrentRunDatabase, ids.opportunity);
assert.equal(failedCurrent.run_id, 'failed');
assert.equal(failedCurrent.status, 'failed');
assert.equal(failedCurrent.current, true);

const staleOnlyDatabase = createCurrentAnalysisDatabase({
  latestSnapshot: currentSnapshot,
  runs: [{ id: 'stale-only', opportunity_id: ids.opportunity, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed', result: { recommendation: 'pause' }, critical_open_count: 2, created_at: '2026-07-24T14:00:00.000Z' }],
});
const staleOnly = await getCurrentTenderAnalysis(staleOnlyDatabase, ids.opportunity);
assert.equal(staleOnly.run_id, 'stale-only');
assert.equal(staleOnly.current, false, 'the latest available old-snapshot run remains visible as a warning, not an authorization gate');

const presented = presentCurrentTenderAnalysis({
  run_id: ids.run,
  snapshot_id: currentSnapshot.id,
  producer: 'siio_rules_v1',
  method: 'rules',
  status: 'completed',
  current: true,
  critical_open_count: 0,
  created_at: '2026-07-24T11:00:00.000Z',
  completed_at: '2026-07-24T11:01:00.000Z',
  result: {
    recommendation: 'GO', summary: 'Lista para decisión humana.', run_id: 'malicious-run', snapshot_id: 'malicious-snapshot', producer: 'AGT-002', method: 'agent_ai', status: 'failed', current: false, critical_open_count: 99, created_at: 'malicious-created', completed_at: 'malicious-completed',
  },
});
assert.equal(presentCurrentTenderAnalysis(null), null, 'missing typed current run stays absent even when legacy history exists');
assert.equal(presented.recommendation, 'GO');
assert.equal(presented.run_id, ids.run, 'authoritative typed metadata must override result keys');
assert.equal(presented.snapshot_id, currentSnapshot.id);
assert.equal(presented.producer, 'siio_rules_v1');
assert.equal(presented.method, 'rules');
assert.equal(presented.status, 'completed');
assert.equal(presented.current, true);
assert.equal(presented.critical_open_count, 0);
assert.equal(presented.created_at, '2026-07-24T11:00:00.000Z');
assert.equal(presented.completed_at, '2026-07-24T11:01:00.000Z');

for (const path of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /import \{ getCurrentTenderAnalysis, presentCurrentTenderAnalysis, registerSiioRulesAnalysis \} from '\.\.\/tender-analysis-foundation\.js';/);
  const generated = source.match(/const analysis = buildTenderDocumentAnalysis[\s\S]{0,700}registerSiioRulesAnalysis/);
  assert.ok(generated, `${path} must register the rules result after building it`);
  assert.match(source, /Preanálisis por reglas SIIO/);
  assert.doesNotMatch(source, /(?:IA|inteligencia artificial|Hermes|AGT-002)[^\n]{0,80}Preanálisis por reglas SIIO/i);
  const records = source.match(/async function getTenderDocumentRecords[\s\S]*?\n}\n\n/);
  assert.ok(records, `${path} must retain the shared tender-document response builder`);
  assert.match(records[0], /getCurrentTenderAnalysis\(database, opportunityId, compatibleDocuments\)/, `${path} must resolve the typed current analysis against the current document hash, not infer authority from timeline history`);
  assert.match(records[0], /analysis:\s*presentCurrentTenderAnalysis\(currentAnalysis\)/, `${path} must present typed metadata plus analysis result to every document response path`);
  assert.match(records[0], /analyses,/, `${path} must preserve legacy timeline history for compatibility`);
}

console.log('tender rules analysis registration passed');
