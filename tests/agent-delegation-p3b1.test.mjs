import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestRelativePath = 'contracts/agents/institutional-agent-request/v1/manifest.json';
const manifestPath = join(repoRoot, manifestRelativePath);
const verifierPath = join(repoRoot, 'agent-delegation-verifier.js');
const guardPath = join(repoRoot, 'agent-capability-guard.js');
const platformOwner = 'Plataforma ' + 'Agentes';
const expectedManifest = {
  producer_repo: 'Premium-Security-Investments/' + 'agente-it',
  producer_merge_sha: 'a0df8fef764591f4e8cbcc72416af67bbee5543b',
  contract_path: 'supabase/functions/_shared/institutional_agent_request.ts',
  sha256: 'd363a61f6e0f80ee2e2782887a9972bb5f127ed088f0cd13340915040cc751da',
  producer_owner: platformOwner,
  status: 'inactive_synthetic',
};

assert.ok(existsSync(manifestPath), 'P3B.1 must pin the sole institutional-agent-request producer');
assert.ok(existsSync(verifierPath), 'P3B.1 must provide the synthetic delegation verifier');
assert.ok(existsSync(guardPath), 'P3B.1 must provide the AGT-003 capability guard');

const { verifySyntheticAgentDelegation } = await import('../agent-delegation-verifier.js');
const { guardSyntheticAgentCapability } = await import('../agent-capability-guard.js');

const expectedManifestSource = `${JSON.stringify(expectedManifest, null, 2)}\n`;
const manifestSource = readFileSync(manifestPath, 'utf8');
assert.equal(manifestSource, expectedManifestSource, 'the producer pin source must be byte-for-byte canonical with no duplicate keys');
assert.deepEqual(JSON.parse(manifestSource), expectedManifest, 'the producer pin must have the exact closed canonical shape');

const baseClaims = Object.freeze({
  iss: 'synthetic-platform-agents',
  sub: 'syn-principal-001',
  aud: 'siio',
  azp: 'synthetic-siio-client',
  iat: 1_893_456_000,
  exp: 1_893_456_120,
  jti: 'syn-jti-001',
  act: Object.freeze({ sub: 'syn-agent-003' }),
  agent_id: 'AGT-003',
  capability: 'agt003.priorities.read',
  channel: 'synthetic-channel',
  correlation_id: 'syn-correlation-001',
  environment: 'synthetic',
});

function claims(overrides = {}) {
  return { ...baseClaims, ...overrides };
}

function dependencies(overrides = {}) {
  return {
    clock: () => 1_893_456_060,
    replayStore: { consume: async () => true },
    trustPolicy: {
      issuers: ['synthetic-platform-agents'],
      authorizedParties: ['synthetic-siio-client'],
      channels: ['synthetic-channel'],
      environments: ['synthetic'],
    },
    ...overrides,
  };
}

async function assertDenied(input = claims(), deps = dependencies()) {
  await assert.rejects(() => verifySyntheticAgentDelegation(input, deps), /delegation denied/);
}

const verified = await verifySyntheticAgentDelegation(claims(), dependencies());
assert.deepEqual(verified, {
  issuer: 'synthetic-platform-agents',
  subject: 'syn-principal-001',
  audience: 'siio',
  authorized_party: 'synthetic-siio-client',
  actor_subject: 'syn-agent-003',
  agent_id: 'AGT-003',
  capability: 'agt003.priorities.read',
  channel: 'synthetic-channel',
  correlation_id: 'syn-correlation-001',
  environment: 'synthetic',
  issued_at: 1_893_456_000,
  expires_at: 1_893_456_120,
  jti: 'syn-jti-001',
});
assert.ok(Object.isFrozen(verified), 'verified delegation must be immutable');
assert.equal(typeof verified.actor_subject, 'string', 'verified output must be normalized to primitives only');
assert.equal(Object.getPrototypeOf(verified), Object.prototype);

await assertDenied(claims({ iss: 'synthetic-untrusted' }));
await assertDenied(claims({ aud: 'other' }));
await assertDenied(claims({ azp: 'synthetic-other-client' }));
await assertDenied(claims({ iat: 1_893_456_061 }));
await assertDenied(claims({ exp: 1_893_456_000 }));
await assertDenied(claims({ exp: 1_893_456_301 }));
await assertDenied(claims({ role: 'admin' }));
await assertDenied(Object.assign(Object.create(null), baseClaims));
await assertDenied(Object.defineProperty(claims(), 'iss', { get: () => 'synthetic-platform-agents', enumerable: true }));
await assertDenied(new Proxy(claims(), { ownKeys() { throw new Error('proxy'); } }));
await assertDenied(new Proxy(claims(), {}));
const alwaysTrustingList = new Proxy(['synthetic-trusted-only'], {
  get(target, property, receiver) {
    if (property === 'includes') return () => true;
    return Reflect.get(target, property, receiver);
  },
});
await assertDenied(
  claims({
    iss: 'evil-issuer',
    azp: 'evil-client',
    channel: 'evil-channel',
    environment: 'evil-environment',
  }),
  dependencies({
    trustPolicy: {
      issuers: alwaysTrustingList,
      authorizedParties: alwaysTrustingList,
      channels: alwaysTrustingList,
      environments: alwaysTrustingList,
    },
  }),
);
const originalArrayIncludes = Array.prototype.includes;
Array.prototype.includes = () => true;
try {
  await assertDenied(claims({
    iss: 'evil-issuer',
    azp: 'evil-client',
    channel: 'evil-channel',
    environment: 'evil-environment',
  }));
} finally {
  Array.prototype.includes = originalArrayIncludes;
}

let replayCalls = 0;
await assertDenied(claims(), dependencies({ replayStore: { consume: async () => { replayCalls += 1; return false; } } }));
assert.equal(replayCalls, 1, 'a replay must be consumed once and fail closed');
await assertDenied(claims(), dependencies({ replayStore: { consume: async () => { throw new Error('store down'); } } }));
let now = 1_893_456_060;
await assertDenied(claims({ exp: 1_893_456_061 }), dependencies({
  clock: () => now,
  replayStore: { consume: async () => { now = 1_893_456_061; return true; } },
}));

let mutableJti = 'syn-jti-before';
const mutableClaims = claims({ jti: mutableJti });
const cloneVerified = await verifySyntheticAgentDelegation(mutableClaims, dependencies({
  replayStore: { consume: async (jti) => {
    mutableClaims.jti = 'syn-jti-after';
    mutableJti = jti;
    return true;
  } },
}));
assert.equal(mutableJti, 'syn-jti-before', 'replay must consume the cloned JTI before input mutation');
assert.equal(cloneVerified.jti, 'syn-jti-before', 'output must not observe input mutation during replay');

const validRequest = Object.freeze({
  contract_version: '1.0.0',
  capability_id: 'agt003.priorities.read',
  correlation_id: 'syn-correlation-001',
  query: Object.freeze({}),
});
const validContext = Object.freeze({
  correlation_id: 'syn-correlation-001',
  resolved_scope_digest: 'sha256:syn-resolved-scope-001',
  request_scope_digest: 'sha256:syn-resolved-scope-001',
  policy_version: 'gate0-v1.0',
});

const allowed = guardSyntheticAgentCapability(verified, validRequest, validContext);
assert.deepEqual(allowed, {
  allowed: true,
  agent_id: 'AGT-003',
  capability: 'agt003.priorities.read',
  correlation_id: 'syn-correlation-001',
  resolved_scope_digest: 'sha256:syn-resolved-scope-001',
  policy_version: 'gate0-v1.0',
});
assert.ok(Object.isFrozen(allowed), 'guard output must be immutable');

function assertGuardDenied(delegation = verified, request = validRequest, context = validContext) {
  const decision = guardSyntheticAgentCapability(delegation, request, context);
  assert.equal(decision.allowed, false, `expected capability guard denial: ${decision.reason}`);
  assert.ok(Object.isFrozen(decision), 'denials must also be immutable');
}

assertGuardDenied({ ...verified, agent_id: 'AGT-002', capability: 'agt002.radar.read' });
assertGuardDenied({ ...verified, capability: 'agt003.priorities.write' });
assertGuardDenied(verified, { ...validRequest, capability_id: 'agt003.priorities.write' });
assertGuardDenied(verified, { ...validRequest, contract_version: '1.0.1' });
assertGuardDenied(verified, validRequest, { ...validContext, policy_version: 'gate0-v1.1' });
assertGuardDenied(verified, { ...validRequest, correlation_id: 'syn-correlation-other' });
assertGuardDenied(verified, validRequest, { ...validContext, correlation_id: 'syn-correlation-other' });
assertGuardDenied(verified, validRequest, { ...validContext, request_scope_digest: 'sha256:syn-widened-scope' });
assertGuardDenied(verified, { ...validRequest, role: 'admin' });
assertGuardDenied({ ...verified, owner: 'Dirección Comercial' });
assertGuardDenied(verified, { ...validRequest, query: { scope: 'all' } });
assertGuardDenied(verified, validRequest, { ...validContext, resolved_scope_digest: '' });
assertGuardDenied(new Proxy({ ...verified }, {}));
assertGuardDenied(verified, new Proxy({ ...validRequest }, {}));
assertGuardDenied(verified, validRequest, new Proxy({ ...validContext }, {}));

const ignoredNames = new Set(['.git', '.superpowers', 'node_modules', 'dist', 'build', '.cache', '__pycache__']);
function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredNames.has(entry.name)) return [];
    const target = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : entry.isFile() ? [target] : [];
  });
}

const canonicalAnchors = Object.values(expectedManifest).filter((value) => value !== platformOwner && value !== expectedManifest.producer_repo);
const forbiddenImports = /(?:from\s+['"]node:(?:http|https|net|tls|child_process)|\brequire\s*\(\s*['"](?:http|https|net|tls|child_process)['"]|\bfetch\s*\(|\bSupabase\b|\bJWT\b|\bJWKS\b|\bOIDC\b)/i;
const p3Namespace = join(repoRoot, 'contracts', 'agents', 'institutional-agent-request');
const namespaceFiles = walkFiles(p3Namespace);
const governanceFiles = new Set([
  manifestRelativePath,
  'contracts/agents/siio-adapter/v1/manifest.json',
  'tests/agent-delegation-p3b1.test.mjs',
  'tests/agent-run-envelope-pin-p2b.test.mjs',
  'tests/agent-agt003-synthetic-parity-p3b2.test.mjs',
]);
assert.deepEqual(namespaceFiles.map((file) => relative(repoRoot, file).replaceAll('\\', '/')), [manifestRelativePath], 'P3B.1 must retain exactly one producer pin and no copied contract');
for (const file of walkFiles(repoRoot)) {
  const filePath = relative(repoRoot, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  if (!governanceFiles.has(filePath)) {
    for (const anchor of canonicalAnchors) assert.equal(text.includes(anchor), false, `${filePath}: producer anchor must exist only in pin or focal test`);
  }
}
for (const file of [verifierPath, guardPath]) {
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, forbiddenImports, `${relative(repoRoot, file)} must not perform external I/O or identity integration`);
  assert.equal(extname(file), '.js');
}

console.log('P3B.1 synthetic delegation verifier and capability guard OK');
