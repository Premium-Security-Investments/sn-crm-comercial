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

assert.deepEqual(pin, expectedPin, 'the pin must have a closed shape with the exact canonical fields and ownership');
assert.match(pin.producer_merge_sha, /^[a-f0-9]{40}$/, 'producer merge SHA must be a 40-hex SHA-1');
assert.match(pin.sha256, /^[a-f0-9]{64}$/, 'contract SHA-256 must be 64 lowercase hex characters');

const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'build', '.superpowers', '.cache', 'cache', '__pycache__']);
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.mts', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const distinctiveEnvelopeKeys = new Set([
  'requested_resource_digest',
  'resolved_scope_digest',
  'requester_channel',
  'human_review_required',
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
    const isAllowedFile = filePath === canonicalPinRelativePath || filePath === ownTestRelativePath;

    if (!isAllowedFile && filePath.toLowerCase().includes('agent-run-envelope')) {
      violations.add('envelope-path');
    }

    if (isAllowedFile || (!textExtensions.has(extname(filePath)) && extname(filePath) !== '')) continue;

    const text = readFileSync(file, 'utf8');
    if (/\bproducer_owner\b\s*[:=]/.test(text)) {
      violations.add('producer-owner');
    }
    if (exactContractAnchors.some(anchor => text.includes(anchor))) {
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
      const envelopeKeyCount = [...collectObjectKeys(parsed)]
        .filter(key => distinctiveEnvelopeKeys.has(key)).length;
      if (envelopeKeyCount >= 3) {
        violations.add('schema-copy');
      }
    }
  }

  return [...violations].sort();
}

assert.deepEqual(auditRepository(repositoryRoot), [], 'repository must retain only the canonical run-envelope pin');

function writeFixtureFile(root, relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}

const mutationRoot = mkdtempSync(join(tmpdir(), 'p2b-envelope-audit-'));
try {
  writeFixtureFile(mutationRoot, canonicalPinRelativePath, JSON.stringify(expectedPin));
  writeFixtureFile(mutationRoot, 'contracts/agents/second-owner.json', JSON.stringify({ producer_owner: 'Plataforma Agentes' }));
  writeFixtureFile(mutationRoot, 'contracts/agents/copied-schema.json', JSON.stringify({
    $id: 'https://example.invalid/copied-envelope.json',
    properties: {
      requested_resource_digest: { type: 'string' },
      resolved_scope_digest: { type: 'string' },
      requester_channel: { type: 'string' },
    },
  }));
  writeFixtureFile(mutationRoot, 'src/agent-run-envelope.js', "export const producer_owner = 'Plataforma Agentes';\n");

  assert.deepEqual(
    auditRepository(mutationRoot),
    ['envelope-path', 'producer-owner', 'schema-copy'],
    'repository audit must reject an owner without id, a changed-id schema copy, and an out-of-contract envelope implementation',
  );
} finally {
  rmSync(mutationRoot, { recursive: true });
}

const serializedPin = JSON.stringify(pin);
for (const forbiddenTerm of [
  'endpoint', 'adapter', 'credential', 'secret', 'token', 'prompt', 'payload', 'pii', 'source', 'runtime',
  '$schema', 'properties', 'required', 'executiongate', 'authorization', 'mutation', 'rpc',
]) {
  assert.equal(serializedPin.toLowerCase().includes(forbiddenTerm), false, `pin must not introduce ${forbiddenTerm}`);
}

assert.equal(Object.values(pin).some(value => typeof value === 'object'), false, 'pin must not copy or reimplement the producer schema');

console.log('P2B agent run-envelope exact contract pin OK');
