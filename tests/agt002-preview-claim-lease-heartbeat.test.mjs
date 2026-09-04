// AGT-002 fenced lease heartbeat — preview claim adapter (RED, no production change).
//
// A V7 semantic-discovery run spends N sequential provider turns under ONE preview claim
// (migration 028's psi_agt002_preview_claims + its fencing token `claim_id`), while the lease was
// sized for exactly two turns (agt002-preview-runtime.js: 2*ceil(timeoutMs/1000)+15). The desired
// remediation is a DETERMINISTIC STAGE-BOUNDARY heartbeat — never a timer: the run renews its own
// lease immediately BEFORE every provider call and immediately before canonical persistence, and
// fails closed if the renewal reports the lease was lost.
//
// This file pins the adapter half of that contract: the wished
// `renewAgt002PreviewClaim(database, { idempotencyKey, claimId, leaseSeconds })` export of
// agt002-preview-persistence.js. It does not exist yet, so the first test below is the RED signal
// (absence of functionality, never a syntax defect or a bad fixture). Nothing here touches a real
// database, network, provider or secret: the only double is the Supabase-shaped `.rpc()` client,
// exactly as in tests/agt002-reanalysis-jobs.test.mjs.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as previewPersistence from '../agt002-preview-persistence.js';

const RENEW_RPC = 'psi_renew_agt002_preview_claim';

// Synthetic identity only: a sha256-shaped idempotency key and a v4-shaped claim uuid.
const IDENTITY = Object.freeze({
  idempotencyKey: 'b'.repeat(64),
  claimId: '00000000-0000-4000-8000-0000000000c1',
  leaseSeconds: 75,
});

function fakeDb({ rpcResults = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
  };
}

/** Single access point, so every test below fails with the same explicit "wished API missing" reason. */
function renew(database, overrides = {}) {
  const renewFn = previewPersistence.renewAgt002PreviewClaim;
  assert.equal(
    typeof renewFn, 'function',
    'agt002-preview-persistence.js must export renewAgt002PreviewClaim(database, { idempotencyKey, claimId, leaseSeconds })',
  );
  return renewFn(database, { ...IDENTITY, ...overrides });
}

test('the preview claim adapter exposes the wished stage-boundary renewal API', () => {
  assert.equal(
    typeof previewPersistence.renewAgt002PreviewClaim, 'function',
    'the fenced heartbeat needs an explicit renewal wrapper; a timer or an implicit background refresh is not the contract',
  );
});

test('renewal maps to the exact snake_case RPC params and returns the camelCase renewed lease', async () => {
  const db = fakeDb({
    rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:01:15.000Z' }, error: null } },
  });
  const result = await renew(db);
  assert.deepEqual(db.rpcCalls, [{
    name: RENEW_RPC,
    args: {
      p_idempotency_key: IDENTITY.idempotencyKey,
      p_claim_id: IDENTITY.claimId,
      p_lease_seconds: IDENTITY.leaseSeconds,
    },
  }], 'the renewal must be one fenced RPC call carrying exactly the idempotency key, the claim_id fencing token and the lease seconds');
  assert.deepEqual(result, { status: 'renewed', leaseExpiresAt: '2026-09-02T00:01:15.000Z' });
});

test('the renewal wrapper never forwards free text or raw provider data', async () => {
  const db = fakeDb({
    rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:01:15.000Z' }, error: null } },
  });
  await renew(db);
  assert.deepEqual(
    Object.keys(db.rpcCalls[0].args).sort(),
    ['p_claim_id', 'p_idempotency_key', 'p_lease_seconds'],
    'a heartbeat carries identity and a bounded duration only — never a message, a result, a prompt or model output',
  );
});

test("a lost lease fails closed with a lease-identifying code and no unsafe follow-up call", async () => {
  const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data: { status: 'lost' }, error: null } } });
  await assert.rejects(
    renew(db),
    error => {
      assert.match(
        String(error?.code ?? ''), /LEASE/,
        'a lost lease must reject with a stable, non-secret code naming the lease so existing closed classifiers can map it',
      );
      return true;
    },
    'status "lost" must never be returned as if the lease had been renewed',
  );
  assert.equal(db.rpcCalls.length, 1, 'a lost lease must not trigger any follow-up call (no release, no re-renew, no persistence)');
});

test('a malformed renewal result never counts as a renewed lease', async () => {
  const malformed = [
    { status: 'renewed' },
    { status: 'renewed', lease_expires_at: '' },
    { status: 'renewed', lease_expires_at: '   ' },
    { status: 'renewed', lease_expires_at: 42 },
    { status: 'renewed', lease_expires_at: null },
    { status: 'bogus', lease_expires_at: '2026-09-02T00:01:15.000Z' },
    { lease_expires_at: '2026-09-02T00:01:15.000Z' },
    true,
    'renewed',
    null,
  ];
  for (const data of malformed) {
    const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data, error: null } } });
    await assert.rejects(renew(db), `${JSON.stringify(data)} must fail closed instead of being accepted as a renewed lease`);
    assert.equal(db.rpcCalls.length, 1, 'a malformed renewal must not trigger any follow-up call');
  }
});

test('a database error on renewal fails closed rather than resolving', async () => {
  const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } } });
  await assert.rejects(renew(db), 'an RPC error must never be swallowed into a successful renewal');
  assert.equal(db.rpcCalls.length, 1);
});

test('an incomplete fenced identity never reaches the database', async () => {
  for (const overrides of [
    { idempotencyKey: '' },
    { idempotencyKey: null },
    { idempotencyKey: undefined },
    { claimId: '' },
    { claimId: null },
    { claimId: undefined },
  ]) {
    const db = fakeDb();
    await assert.rejects(renew(db, overrides), `${JSON.stringify(overrides)} must be rejected before any RPC`);
    assert.equal(db.rpcCalls.length, 0, 'an unfenced renewal (missing idempotency_key or claim_id) must never reach the database');
  }
});

test('an invalid lease duration never reaches the database', async () => {
  // The 1..600 window mirrors the bound migration 028 already enforces for the initial claim, so a
  // heartbeat can never quietly extend a reservation past the operational ceiling.
  for (const leaseSeconds of [0, -1, 1.5, 601, 100000, '75', null, undefined, NaN, Infinity]) {
    const db = fakeDb();
    await assert.rejects(renew(db, { leaseSeconds }), `leaseSeconds=${String(leaseSeconds)} must be rejected before any RPC`);
    assert.equal(db.rpcCalls.length, 0, 'an out-of-range or non-integer lease duration must never reach the database');
  }
  // The inclusive boundaries stay usable.
  for (const leaseSeconds of [1, 600]) {
    const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:10:00.000Z' }, error: null } } });
    await renew(db, { leaseSeconds });
    assert.equal(db.rpcCalls[0].args.p_lease_seconds, leaseSeconds);
  }
});
