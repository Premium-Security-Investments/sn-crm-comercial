import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';

const SECRET = 'a'.repeat(32);

function slowCodexClient({ interruptCalls }) {
  return {
    run({ timeoutMs, signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }), timeoutMs + 10_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          interruptCalls.push('aborted');
          const error = new Error('cancelled');
          error.code = 'AGT002_CODEX_CANCELLED';
          reject(error);
        }, { once: true });
      });
    },
  };
}

async function testServerTimesOutIndependentlyOfSlowProvider() {
  const codexClient = { run: ({ timeoutMs }) => new Promise((resolve) => setTimeout(resolve, timeoutMs + 5_000)) };
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/v1/agt002-preview/run`;
  try {
    const client = createAgt002HetznerBridgeClient({ url, hmacSecret: SECRET });
    await assert.rejects(
      () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 200, idempotencyKey: 'idem-timeout' }),
      () => true,
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function testClientAbortTriggersServerInterruptAndNoOrphanProcess() {
  const interruptCalls = [];
  const codexClient = slowCodexClient({ interruptCalls });
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/v1/agt002-preview/run`;
  try {
    const client = createAgt002HetznerBridgeClient({ url, hmacSecret: SECRET });
    const controller = new AbortController();
    const runPromise = client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 30_000, idempotencyKey: 'idem-abort', signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(() => runPromise, () => true);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(interruptCalls, ['aborted']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

await testServerTimesOutIndependentlyOfSlowProvider();
await testClientAbortTriggersServerInterruptAndNoOrphanProcess();
console.log('agt002-hetzner-bridge-timeout.integration.test.mjs OK');
