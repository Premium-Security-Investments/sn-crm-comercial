// AGT-002 P0-02 (RED) — neutral initial-analysis evidence package, DB-orchestration half.
//
// Mirrors the conventions of tests/agt002-governed-document-workset-api.test.mjs. The critical
// DIFFERENCE this file pins: freezeAgt002EvidencePackage never enqueues any job (initial or
// reanalysis) — projectAgt002EvidencePackageFreezeResult's whitelist carries no job/run field at
// all, unlike the governed workset's FREEZE_RESULT_KEYS (which carries run_id/reanalysis_job_id).
// A dedicated static source-scan (bottom of this file) additionally pins that neither new module
// ever imports from, or references, the reanalysis operational surface — the same boundary
// scripts/agt002_initial_analysis_guard.mjs (P0-00) enforces for the initial-analysis slice.
//
// Neither agt002-evidence-packages.js nor agt002-evidence-package-api.js exists yet: every
// import below fails module resolution (RED).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  invalidEvidencePackageInputError,
  evidencePackageConflictError,
  validateAgt002EvidencePackageFreezeRequest,
  mapAgt002EvidencePackageFreezeRpcError,
  resolveAgt002EvidencePackageCandidates,
  freezeAgt002EvidencePackage,
  projectAgt002EvidencePackageFreezeResult,
} from '../agt002-evidence-package-api.js';

function uuid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function hex64(label) {
  const base = Buffer.from(String(label)).toString('hex');
  return base.repeat(Math.ceil(64 / base.length)).slice(0, 64);
}

const OPPORTUNITY_ID = uuid('opportunity-1');
const TENDER_ID = uuid('tender-1');
const ACTOR_ID = uuid('actor-1');
const DOC_IDS = Array.from({ length: 13 }, (_, i) => uuid(`doc-${i + 1}`));
const EXTRACTION_IDS = Array.from({ length: 13 }, (_, i) => uuid(`extraction-${i + 1}`));
const CONTENT_HASHES = Array.from({ length: 13 }, (_, i) => hex64(`content-${i + 1}`));
const TEXT_HASHES = Array.from({ length: 13 }, (_, i) => hex64(`text-${i + 1}`));

function requestedMember(i, overrides = {}) {
  return {
    document_version_id: DOC_IDS[i],
    source_classification: 'official',
    inclusion_reason: `Reason ${i} for including this document.`,
    ...overrides,
  };
}

function candidateFor(i, overrides = {}) {
  return {
    document_version_id: DOC_IDS[i],
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    current: true,
    extraction_status: 'ok',
    content_hash: CONTENT_HASHES[i],
    extraction_id: EXTRACTION_IDS[i],
    extraction_text_hash: TEXT_HASHES[i],
    ...overrides,
  };
}

/** Minimal supabase-js-shaped fake: .rpc() only — this module never touches .from(). */
function fakeDb({ rpcResults = {} } = {}) {
  const calls = { rpc: [] };
  return {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      const queued = rpcResults[name];
      const next = Array.isArray(queued) ? queued.shift() : queued;
      if (typeof next === 'function') return Promise.resolve(next(args));
      return Promise.resolve(next || { data: null, error: null });
    },
  };
}

describe('validateAgt002EvidencePackageFreezeRequest', () => {
  it('accepts exactly {opportunity_id, documents}', () => {
    const body = { opportunity_id: OPPORTUNITY_ID, documents: [requestedMember(0)] };
    const result = validateAgt002EvidencePackageFreezeRequest(body);
    assert.equal(result.opportunityId, OPPORTUNITY_ID);
    assert.equal(result.requestedMembers.length, 1);
  });

  it('accepts 13 documents, since the request carries no functional package member limit', () => {
    const body = { opportunity_id: OPPORTUNITY_ID, documents: DOC_IDS.map((_, i) => requestedMember(i)) };
    const result = validateAgt002EvidencePackageFreezeRequest(body);
    assert.equal(result.requestedMembers.length, 13);
  });

  it('rejects a body carrying any key other than opportunity_id/documents — tender_id is never a client input', () => {
    for (const extra of ['tender_id', 'snapshot_id', 'context_version_id', 'package_hash']) {
      const body = { opportunity_id: OPPORTUNITY_ID, documents: [requestedMember(0)], [extra]: 'x' };
      assert.throws(() => validateAgt002EvidencePackageFreezeRequest(body), (err) => err.status === 400);
    }
  });

  it('rejects a malformed opportunity_id', () => {
    assert.throws(() => validateAgt002EvidencePackageFreezeRequest({ opportunity_id: 'not-a-uuid', documents: [requestedMember(0)] }), (err) => err.status === 400);
  });

  it('rejects a non-object body', () => {
    for (const bad of [null, 'x', 42, [], undefined]) {
      assert.throws(() => validateAgt002EvidencePackageFreezeRequest(bad), (err) => err.status === 400);
    }
  });

  it('delegates document validation errors as a 400', () => {
    assert.throws(() => validateAgt002EvidencePackageFreezeRequest({ opportunity_id: OPPORTUNITY_ID, documents: [] }), (err) => err.status === 400);
  });
});

describe('invalidEvidencePackageInputError / evidencePackageConflictError', () => {
  it('produce a 400 with the closed invalid_evidence_package_input code', () => {
    const err = invalidEvidencePackageInputError('bad');
    assert.equal(err.status, 400);
    assert.equal(err.code, 'invalid_evidence_package_input');
  });

  it('produce a 409 with the closed evidence_package_conflict code', () => {
    const err = evidencePackageConflictError('conflict');
    assert.equal(err.status, 409);
    assert.equal(err.code, 'evidence_package_conflict');
  });
});

describe('mapAgt002EvidencePackageFreezeRpcError', () => {
  const CASES = [
    ['22023', 400, 'invalid_evidence_package_input'],
    ['42501', 403, 'evidence_package_forbidden'],
    ['P0002', 404, 'evidence_package_reference_not_found'],
    ['55000', 409, 'evidence_package_conflict'],
    ['23505', 409, 'evidence_package_conflict'],
  ];
  for (const [pgCode, httpStatus, code] of CASES) {
    it(`maps Postgres errcode ${pgCode} to HTTP ${httpStatus}/${code}`, () => {
      const mapped = mapAgt002EvidencePackageFreezeRpcError({ code: pgCode, message: 'boom' });
      assert.equal(mapped.status, httpStatus);
      assert.equal(mapped.code, code);
    });
  }

  it('defaults an unrecognized errcode to a safe 500', () => {
    const mapped = mapAgt002EvidencePackageFreezeRpcError({ code: 'XXYYZ', message: 'boom' });
    assert.equal(mapped.status, 500);
  });
});

describe('resolveAgt002EvidencePackageCandidates', () => {
  it('calls psi_resolve_agt002_evidence_package_candidate once per member, in canonical order', async () => {
    const members = [0, 1, 2].map((i) => requestedMember(i));
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_evidence_package_candidate: [
          { data: candidateFor(0), error: null },
          { data: candidateFor(1), error: null },
          { data: candidateFor(2), error: null },
        ],
      },
    });
    const rows = await resolveAgt002EvidencePackageCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members });
    assert.equal(rows.length, 3);
    assert.deepEqual(
      db.calls.rpc.map((c) => c.args.p_document_version_id),
      members.map((m) => m.document_version_id),
    );
  });

  it('never calls a bulk/listing RPC — one resolve call per member only', async () => {
    const members = [0, 1].map((i) => requestedMember(i));
    const db = fakeDb({ rpcResults: { psi_resolve_agt002_evidence_package_candidate: [{ data: candidateFor(0), error: null }, { data: candidateFor(1), error: null }] } });
    await resolveAgt002EvidencePackageCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members });
    assert.ok(db.calls.rpc.every((c) => c.name === 'psi_resolve_agt002_evidence_package_candidate'));
    assert.equal(db.calls.rpc.length, 2);
  });

  it('aborts immediately on the first resolution error — fail closed, no partial package', async () => {
    const members = [0, 1, 2].map((i) => requestedMember(i));
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_evidence_package_candidate: [
          { data: candidateFor(0), error: null },
          { data: null, error: { code: '22023', message: 'documento fuera de alcance' } },
          { data: candidateFor(2), error: null },
        ],
      },
    });
    await assert.rejects(resolveAgt002EvidencePackageCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members }));
    assert.equal(db.calls.rpc.length, 2, 'the loop must never continue past a failure to resolve the remaining members');
  });

  it('fails closed when the RPC returns no data', async () => {
    const members = [requestedMember(0)];
    const db = fakeDb({ rpcResults: { psi_resolve_agt002_evidence_package_candidate: { data: null, error: null } } });
    await assert.rejects(resolveAgt002EvidencePackageCandidates(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members }));
  });
});

describe('freezeAgt002EvidencePackage — orchestration', () => {
  function happyDb(members, overrides = {}) {
    return fakeDb({
      rpcResults: {
        psi_resolve_agt002_evidence_package_candidate: members.map((m, i) => ({ data: candidateFor(DOC_IDS.indexOf(m.document_version_id)), error: null })),
        psi_freeze_agt002_evidence_package: {
          data: {
            status: 'created',
            package_id: uuid('package-1'),
            package_version_id: uuid('package-version-1'),
            version_number: 1,
            batch_count: 1,
            member_count: members.length,
            package_hash: hex64('package-hash'),
            document_manifest_hash: hex64('doc-manifest'),
            semantic_manifest_hash: hex64('semantic-manifest'),
            ...overrides,
          },
          error: null,
        },
      },
    });
  }

  it('requires an explicit actorProfileId', async () => {
    const members = [requestedMember(0)];
    const db = happyDb(members);
    await assert.rejects(freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, requestedMembers: members }));
  });

  it('resolves candidates, then calls psi_freeze_agt002_evidence_package exactly once', async () => {
    const members = [0, 1].map((i) => requestedMember(i));
    const db = happyDb(members);
    const result = await freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: members });
    assert.equal(result.status, 'created');
    const freezeCalls = db.calls.rpc.filter((c) => c.name === 'psi_freeze_agt002_evidence_package');
    assert.equal(freezeCalls.length, 1);
  });

  it('accepts 13 requested members end to end (no functional package member limit), producing 2 batches', async () => {
    const members = DOC_IDS.map((_, i) => requestedMember(i));
    const db = happyDb(members, { batch_count: 2, member_count: 13 });
    const result = await freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: members });
    assert.equal(result.batch_count, 2);
    assert.equal(result.member_count, 13);
  });

  it('the result never carries any job/run identity field — freeze creates ZERO initial or reanalysis jobs', async () => {
    const members = [requestedMember(0)];
    const db = happyDb(members);
    const result = await freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: members });
    const serializedKeys = Object.keys(result).join(',').toLowerCase();
    assert.ok(!serializedKeys.includes('job'), `result must never carry a job-shaped key; got keys: ${Object.keys(result).join(',')}`);
    assert.ok(!serializedKeys.includes('run'), `result must never carry a run-shaped key; got keys: ${Object.keys(result).join(',')}`);
  });

  it('the result never carries a job/run field even if the RPC response maliciously/accidentally includes one', async () => {
    const members = [requestedMember(0)];
    const db = happyDb(members, { reanalysis_job_id: uuid('unexpected-job'), run_id: uuid('unexpected-run') });
    const result = await freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: members });
    const projected = projectAgt002EvidencePackageFreezeResult(result);
    assert.equal(projected.reanalysis_job_id, undefined);
    assert.equal(projected.run_id, undefined);
  });

  it('maps an RPC error through mapAgt002EvidencePackageFreezeRpcError', async () => {
    const members = [requestedMember(0)];
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_evidence_package_candidate: { data: candidateFor(0), error: null },
        psi_freeze_agt002_evidence_package: { data: null, error: { code: '55000', message: 'conflicto' } },
      },
    });
    await assert.rejects(
      freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: members }),
      (err) => err.status === 409,
    );
  });

  it('fails closed when the RPC returns a malformed result', async () => {
    const members = [requestedMember(0)];
    const db = fakeDb({
      rpcResults: {
        psi_resolve_agt002_evidence_package_candidate: { data: candidateFor(0), error: null },
        psi_freeze_agt002_evidence_package: { data: { status: 'created' }, error: null },
      },
    });
    await assert.rejects(freezeAgt002EvidencePackage(db, { opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, actorProfileId: ACTOR_ID, requestedMembers: members }));
  });
});

describe('projectAgt002EvidencePackageFreezeResult', () => {
  it('whitelists exactly the closed identity/status/hash fields — no job/run field in the vocabulary at all', () => {
    const raw = {
      status: 'created',
      package_id: uuid('package-1'),
      package_version_id: uuid('package-version-1'),
      version_number: 1,
      batch_count: 1,
      member_count: 1,
      package_hash: hex64('package'),
      document_manifest_hash: hex64('doc'),
      semantic_manifest_hash: hex64('semantic'),
      extra_internal_field: 'must be stripped',
    };
    const projected = projectAgt002EvidencePackageFreezeResult(raw);
    assert.deepEqual(Object.keys(projected).sort(), [
      'batch_count',
      'document_manifest_hash',
      'member_count',
      'package_hash',
      'package_id',
      'package_version_id',
      'semantic_manifest_hash',
      'status',
      'version_number',
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// Static reanalysis-boundary scan — mirrors scripts/agt002_initial_analysis_guard.mjs's own
// production-source scan (P0-00). Read directly with fs so this test can run and report RED
// for "module missing" today, and keep enforcing the boundary once the modules exist: neither
// new module may ever reference the reanalysis operational surface.
// ---------------------------------------------------------------------------------------
describe('reanalysis-boundary: the evidence package modules never couple to the reanalysis operational surface', () => {
  const REANALYSIS_MODULE_SPECIFIERS = [
    'agt002-reanalysis-api.js',
    'agt002-reanalysis-jobs.js',
    'agt002-reanalysis-worker.js',
    'agt002-reanalysis-input.js',
    'agt002-reanalysis-executor.js',
    'agt002-reanalysis-error-message.js',
  ];
  const REANALYSIS_TABLE_NAME = 'psi_agt002_reanalysis_jobs';
  const REANALYSIS_RPC_NAMES = [
    'psi_create_agt002_reanalysis_job',
    'psi_claim_agt002_reanalysis_job',
    'psi_complete_agt002_reanalysis_job',
    'psi_fail_agt002_reanalysis_job',
  ];

  const MODULE_PATHS = [
    new URL('../agt002-evidence-packages.js', import.meta.url),
    new URL('../agt002-evidence-package-api.js', import.meta.url),
  ];

  for (const modulePath of MODULE_PATHS) {
    it(`${modulePath.pathname.split('/').pop()} exists and never references a reanalysis module specifier, table, or RPC`, () => {
      assert.ok(fs.existsSync(modulePath), `${modulePath.pathname} must exist (P0-02 implementation)`);
      const content = fs.readFileSync(modulePath, 'utf8');
      for (const specifier of REANALYSIS_MODULE_SPECIFIERS) {
        assert.ok(!content.includes(specifier), `must never reference reanalysis module ${specifier}`);
      }
      assert.ok(!content.includes(REANALYSIS_TABLE_NAME), `must never reference the reanalysis jobs table ${REANALYSIS_TABLE_NAME}`);
      for (const rpcName of REANALYSIS_RPC_NAMES) {
        assert.ok(!content.includes(rpcName), `must never reference the reanalysis RPC ${rpcName}`);
      }
    });
  }
});
