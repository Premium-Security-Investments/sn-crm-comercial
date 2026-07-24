import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  buildTenderSnapshotInput,
  getCurrentTenderAnalysis,
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
  { id: 'b', name: 'B', document_type: 'pliego', extracted_text: 'no incluir', signed_url: 'https://private.example/b', current: true },
  { id: 'a', name: 'A', document_type: 'anexo_tecnico', extracted_text: 'no incluir', signed_url: 'https://private.example/a', current: true },
];

const left = buildTenderSnapshotInput(documents, { version: 1, nested: { z: 'z', a: 'a' } });
const right = buildTenderSnapshotInput([...documents].reverse(), { nested: { a: 'a', z: 'z' }, version: 1 });
assert.equal(left.document_hash, right.document_hash);
assert.equal(left.profile_hash, right.profile_hash);
assert.equal(left.documents[0].id, 'a');
assert.equal(left.documents[0].extracted_text, undefined);
assert.equal(left.documents[0].signed_url, undefined);
assert.deepEqual(left.company_profile, { nested: { a: 'a', z: 'z' }, version: 1 });

const calls = [];
const database = {
  async rpc(name, params) {
    calls.push({ name, params });
    if (name === 'psi_record_tender_document_snapshot') return { data: { id: ids.snapshot }, error: null };
    if (name === 'psi_record_tender_analysis_run') return { data: { id: ids.run, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed' }, error: null };
    throw new Error(`unexpected RPC ${name}`);
  },
};
const result = { recommendation: 'GO condicionado', questions: [{ critical: true }] };
const registered = await registerSiioRulesAnalysis(database, {
  opportunity_id: ids.opportunity,
  tender_id: ids.tender,
  actor_id: ids.actor,
  documents,
  company_profile: { version: 1 },
  result,
});
assert.equal(registered.run_id, ids.run);
assert.equal(registered.snapshot_id, ids.snapshot);
assert.equal(registered.producer, 'siio_rules_v1');
assert.equal(registered.method, 'rules');
assert.equal(registered.status, 'completed');
assert.equal(registered.current, true);
assert.deepEqual(registered.result, result);
assert.deepEqual(calls.map(call => call.name), ['psi_record_tender_document_snapshot', 'psi_record_tender_analysis_run']);
assert.equal(calls[0].params.p_actor_id, ids.actor);
assert.equal(calls[1].params.p_producer, 'siio_rules_v1');
assert.equal(calls[1].params.p_method, 'rules');
assert.equal(calls[1].params.p_status, 'completed');
assert.equal(calls[1].params.p_policy_version, 'siio-rules-v1');
assert.equal(calls[1].params.p_model, null);
assert.deepEqual(calls[1].params.p_usage, { input_tokens: 0, output_tokens: 0, cost_usd: 0 });
assert.equal(calls[1].params.p_critical_open_count, 1);
assert.match(calls[1].params.p_idempotency_key, /^[0-9a-f]{64}$/);

const failedDatabase = { async rpc() { return { data: null, error: { message: 'RPC unavailable' } }; } };
await assert.rejects(() => registerSiioRulesAnalysis(failedDatabase, {
  opportunity_id: ids.opportunity, tender_id: ids.tender, actor_id: ids.actor, documents, company_profile: {}, result,
}), /RPC unavailable/);

const currentDatabase = {
  from(table) {
    const filters = [];
    const chain = {
      select() { return chain; },
      eq(key, value) { filters.push([key, value]); return chain; },
      order() { return chain; },
      limit() {
        if (table === 'psi_tender_document_snapshots') return Promise.resolve({ data: [{ id: ids.snapshot }], error: null });
        assert.equal(table, 'psi_tender_analysis_runs');
        return Promise.resolve({ data: [{ id: ids.run, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed', result, critical_open_count: 1 }], error: null });
      },
    };
    return chain;
  },
};
const current = await getCurrentTenderAnalysis(currentDatabase, ids.opportunity);
assert.equal(current.run_id, ids.run);
assert.equal(current.current, true);
assert.deepEqual(current.result, result);

const staleDatabase = {
  from(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() {
        if (table === 'psi_tender_document_snapshots') return Promise.resolve({ data: [{ id: '77777777-7777-4777-8777-777777777777' }], error: null });
        return Promise.resolve({ data: [{ id: ids.run, snapshot_id: ids.snapshot, producer: 'siio_rules_v1', method: 'rules', status: 'completed', result, critical_open_count: 1 }], error: null });
      },
    };
    return chain;
  },
};
const stale = await getCurrentTenderAnalysis(staleDatabase, ids.opportunity);
assert.equal(stale.current, false, 'a run for an older snapshot must not be current');

for (const path of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /registerSiioRulesAnalysis/);
  const generated = source.match(/const analysis = buildTenderDocumentAnalysis[\s\S]{0,700}registerSiioRulesAnalysis/);
  assert.ok(generated, `${path} must register the rules result after building it`);
  assert.match(source, /Preanálisis por reglas SIIO/);
  assert.doesNotMatch(source, /(?:IA|inteligencia artificial|Hermes|AGT-002)[^\n]{0,80}Preanálisis por reglas SIIO/i);
}

console.log('tender rules analysis registration passed');
