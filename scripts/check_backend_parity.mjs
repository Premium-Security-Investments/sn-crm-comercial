import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buffersAreEqual(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function checkBackendParity() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [serverBackend, apiBackend] = await Promise.all([
    readFile(resolve(projectRoot, 'server/index.js')),
    readFile(resolve(projectRoot, 'api/[...path].js')),
  ]);

  if (!buffersAreEqual(serverBackend, apiBackend)) {
    throw new Error('backend parity failed: server/index.js and api/[...path].js differ');
  }

  console.log('backend parity OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkBackendParity().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
