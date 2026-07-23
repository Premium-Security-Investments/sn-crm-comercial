import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const contractsRoot = join(repositoryRoot, 'contracts', 'agents');
const pinPath = join(contractsRoot, 'agent-run-envelope', 'v1', 'manifest.json');
const canonicalPinRelativePath = 'contracts/agents/agent-run-envelope/v1/manifest.json';
const ownTestRelativePath = 'tests/agent-run-envelope-pin-p2b.test.mjs';
const institutionalRequestPinRelativePath = 'contracts/agents/institutional-agent-request/v1/manifest.json';
const separatelyGovernedP3b2Files = new Set([
  'contracts/agents/siio-adapter/v1/manifest.json',
  'tests/agent-agt003-synthetic-parity-p3b2.test.mjs',
]);

assert.ok(existsSync(pinPath), 'P2B must add the sole machine-readable run-envelope pin');

const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
const expectedPin = {
  producer_repo: 'Premium-Security-Investments/agente-it',
  producer_merge_sha: 'a4d914849126f870f0d66be4914ab6a89a6225ba',
  contract_version: 'v1',
  contract_path: 'catalog/agent-run-envelope-v1.schema.json',
  contract_id: 'https://agente-it.local/contracts/agent-run-envelope/v1/schema.json',
  sha256: 'f14d900cd15238657a233ac0415fdd6870547e36b1d6ed16f09c8e3dadcb1474',
  producer_owner: 'Plataforma Agentes',
};
const expectedInstitutionalRequestPin = {
  producer_repo: expectedPin.producer_repo,
  producer_merge_sha: 'a0df8fef764591f4e8cbcc72416af67bbee5543b',
  contract_path: 'supabase/functions/_shared/institutional_agent_request.ts',
  sha256: 'd363a61f6e0f80ee2e2782887a9972bb5f127ed088f0cd13340915040cc751da',
  producer_owner: expectedPin.producer_owner,
  status: 'inactive_synthetic',
};

assert.deepEqual(pin, expectedPin, 'the pin must have a closed shape with the exact canonical fields and ownership');
assert.match(pin.producer_merge_sha, /^[a-f0-9]{40}$/, 'producer merge SHA must be a 40-hex SHA-1');
assert.match(pin.sha256, /^[a-f0-9]{64}$/, 'contract SHA-256 must be 64 lowercase hex characters');

const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'build', '.superpowers', '.cache', 'cache', '__pycache__']);
const distinctiveEnvelopeKeys = new Set([
  'requested_resource_digest',
  'resolved_scope_digest',
  'requester_channel',
  'approval_reference',
  'result_digest',
]);
const exactContractAnchors = [
  expectedPin.producer_repo,
  expectedPin.producer_merge_sha,
  expectedPin.contract_path,
  expectedPin.contract_id,
  expectedPin.sha256,
];

function walkRelevantFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignoredDirectoryNames.has(entry.name)) return [];
    const location = join(directory, entry.name);
    if (entry.isDirectory()) return walkRelevantFiles(location);
    return entry.isFile() ? [location] : [];
  });
}

function collectObjectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectObjectKeys(item, keys));
  } else if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      keys.add(key);
      collectObjectKeys(nestedValue, keys);
    }
  }
  return keys;
}

function declaresPlatformOwner(value) {
  if (Array.isArray(value)) return value.some(declaresPlatformOwner);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replaceAll('-', '_');
    const isOwnerKey = normalizedKey === 'owner' || normalizedKey.endsWith('_owner') || normalizedKey === 'propietario';
    return (isOwnerKey && nestedValue === expectedPin.producer_owner) || declaresPlatformOwner(nestedValue);
  });
}

function isExactInstitutionalRequestPin(filePath, text) {
  if (filePath !== institutionalRequestPinRelativePath) return false;
  return text === `${JSON.stringify(expectedInstitutionalRequestPin, null, 2)}\n`;
}

function auditRepository(root) {
  const violations = new Set();
  const namespaceRoot = join(root, 'contracts', 'agents', 'agent-run-envelope');
  const namespaceFiles = existsSync(namespaceRoot) ? walkRelevantFiles(namespaceRoot) : [];
  const canonicalPinPath = join(root, canonicalPinRelativePath);

  if (namespaceFiles.length !== 1 || namespaceFiles[0] !== canonicalPinPath) {
    violations.add('namespace-copy');
  }

  for (const file of walkRelevantFiles(root)) {
    const filePath = relative(root, file).split('\\').join('/');
    const isAllowedFile = filePath === canonicalPinRelativePath
      || filePath === ownTestRelativePath
      || separatelyGovernedP3b2Files.has(filePath);

    if (!isAllowedFile && filePath.toLowerCase().includes('agent-run-envelope')) {
      violations.add('envelope-path');
    }

    if (isAllowedFile) continue;

    const bytes = readFileSync(file);
    const text = bytes.toString('utf8');
    const isExactInstitutionalPin = isExactInstitutionalRequestPin(filePath, text);
    if (filePath === institutionalRequestPinRelativePath && !isExactInstitutionalPin) {
      violations.add('institutional-request-pin');
    }
    if (!isExactInstitutionalPin && /\b(?:producer_)?owner\b\s*[:=]\s*['"]Plataforma Agentes['"]/.test(text)) {
      violations.add('producer-owner');
    }
    if (
      exactContractAnchors.some(anchor =>
        text.includes(anchor) && !(isExactInstitutionalPin && anchor === expectedPin.producer_repo)
      )
    ) {
      violations.add('canonical-anchor');
    }

    if (extname(filePath) === '.json') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        violations.add('invalid-json');
        continue;
      }
      if (!isExactInstitutionalPin && declaresPlatformOwner(parsed)) {
        violations.add('producer-owner');
      }
      const envelopeKeyCount = [...collectObjectKeys(parsed)]
        .filter(key => distinctiveEnvelopeKeys.has(key)).length;
      if (envelopeKeyCount >= 1) {
        violations.add('schema-copy');
      }
    }
  }

  return [...violations].sort();
}

assert.deepEqual(
  auditRepository(repositoryRoot),
  [],
  'repository must retain only the canonical run-envelope pin while allowing the separately governed institutional-request pin',
);

function writeFixtureFile(root, relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}

function assertMutationRejected(relativePath, contents, expectedViolation) {
  const mutationRoot = mkdtempSync(join(tmpdir(), 'p2b-envelope-audit-'));
  try {
    writeFixtureFile(mutationRoot, canonicalPinRelativePath, JSON.stringify(expectedPin));
    writeFixtureFile(mutationRoot, relativePath, contents);
    assert.ok(
      auditRepository(mutationRoot).includes(expectedViolation),
      `${relativePath} must be rejected as ${expectedViolation}`,
    );
  } finally {
    rmSync(mutationRoot, { recursive: true });
  }
}

assertMutationRejected(
  'contracts/agents/second-owner.json',
  JSON.stringify({ producer_owner: 'Plataforma Agentes' }),
  'producer-owner',
);
assertMutationRejected(
  'contracts/agents/copied-schema.json',
  JSON.stringify({ $id: 'https://example.invalid/copied-envelope.json', properties: { requested_resource_digest: { type: 'string' } } }),
  'schema-copy',
);
assertMutationRejected(
  'src/agent-run-envelope.js',
  "export const producer_owner = 'Plataforma Agentes';\n",
  'envelope-path',
);
assertMutationRejected(
  'implementation/run.py',
  "producer_owner = 'Plataforma Agentes'\nendpoint = '/agent-runs'\n",
  'producer-owner',
);
assertMutationRejected(
  'contracts/agents/second-owner-generic.json',
  JSON.stringify({ owner: 'Plataforma Agentes', contract_version: 'v2' }),
  'producer-owner',
);
assertMutationRejected(
  'contracts/agents/partial-schema.json',
  JSON.stringify({ $id: 'https://example.invalid/partial.json', properties: { requested_resource_digest: {}, resolved_scope_digest: {} } }),
  'schema-copy',
);
assertMutationRejected(
  'implementation/pin.bin',
  Buffer.concat([Buffer.from([0]), Buffer.from("producer_owner = 'Plataforma Agentes'\n")]),
  'producer-owner',
);
assertMutationRejected(
  'notes/producer-repo.txt',
  expectedPin.producer_repo,
  'canonical-anchor',
);
assertMutationRejected(
  institutionalRequestPinRelativePath,
  JSON.stringify({ ...expectedInstitutionalRequestPin, extra_owner: expectedPin.producer_owner }),
  'institutional-request-pin',
);
const duplicateOwnerManifest = `${JSON.stringify(expectedInstitutionalRequestPin, null, 2)}\n`.replace(
  `  "producer_owner": "${expectedPin.producer_owner}",`,
  `  "producer_owner": "attacker",\n  "producer_owner": "${expectedPin.producer_owner}",`,
);
assertMutationRejected(
  institutionalRequestPinRelativePath,
  duplicateOwnerManifest,
  'institutional-request-pin',
);

const serializedPin = JSON.stringify(pin);
for (const forbiddenTerm of [
  'endpoint', 'adapter', 'credential', 'secret', 'token', 'prompt', 'payload', 'pii', 'source', 'runtime',
  '$schema', 'properties', 'required', 'executiongate', 'authorization', 'mutation', 'rpc',
]) {
  assert.equal(serializedPin.toLowerCase().includes(forbiddenTerm), false, `pin must not introduce ${forbiddenTerm}`);
}

assert.equal(Object.values(pin).some(value => typeof value === 'object'), false, 'pin must not copy or reimplement the producer schema');

console.log('P2B agent run-envelope exact contract pin OK');
