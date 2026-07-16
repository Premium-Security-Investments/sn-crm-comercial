import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');

const serverBackend = await readFile(resolve(projectRoot, 'server/index.js'));
const apiBackend = await readFile(resolve(projectRoot, 'api/[...path].js'));

assert.equal(
  buffersAreEqual(serverBackend, apiBackend),
  true,
  'the deployed backends must remain byte-for-byte identical',
);
assert.equal(
  buffersAreEqual(Buffer.from('backend-a'), Buffer.from('backend-b')),
  false,
  'different backend buffers must be detected',
);

console.log('backend parity tests OK');
