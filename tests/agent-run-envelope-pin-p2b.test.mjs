import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const contractsRoot = fileURLToPath(new URL('../contracts/agents', import.meta.url));
const pinPath = new URL('../contracts/agents/agent-run-envelope/v1/manifest.json', import.meta.url);

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

function walkJsonFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const location = join(directory, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(location);
    return entry.isFile() && entry.name.endsWith('.json') ? [location] : [];
  });
}

const contractPins = walkJsonFiles(contractsRoot).filter(file => readFileSync(file, 'utf8').includes(pin.contract_id));
assert.deepEqual(contractPins, [pinPath.pathname], 'SIIO must keep one run-envelope owner/pin and no duplicate source of truth');

const serializedPin = JSON.stringify(pin);
for (const forbiddenTerm of [
  'endpoint', 'adapter', 'credential', 'secret', 'token', 'prompt', 'payload', 'pii', 'source', 'runtime',
  '$schema', 'properties', 'required', 'executiongate', 'authorization', 'mutation', 'rpc',
]) {
  assert.equal(serializedPin.toLowerCase().includes(forbiddenTerm), false, `pin must not introduce ${forbiddenTerm}`);
}

assert.equal(Object.values(pin).some(value => typeof value === 'object'), false, 'pin must not copy or reimplement the producer schema');

console.log('P2B agent run-envelope exact contract pin OK');
