import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAgt002IncrementalWorkerDispatchClient } from '../agt002-incremental-worker-dispatch-client.js';
import { AGT002_INCREMENTAL_DISPATCH_PATH, createAgt002IncrementalWorkerDispatchServer } from '../agt002-incremental-worker-dispatch-server.js';

const SECRET = 'r1-dispatch-secret-'.padEnd(40, 'x');
const J1 = '10000000-0000-4000-8000-000000000001';
const J2 = '10000000-0000-4000-8000-000000000002';

function inMemoryFetch(listener) {
  return async (url, options) => new Promise(resolve => {
    const req = new EventEmitter();
    req.method = options.method;
    req.url = new URL(url).pathname;
    req.headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]));
    const res = {
      status: 500,
      writeHead(status) { this.status = status; },
      end(raw) {
        const payload = JSON.parse(raw);
        resolve({ status: this.status, ok: this.status >= 200 && this.status < 300, json: async () => payload });
      },
    };
    listener(req, res);
    queueMicrotask(() => { req.emit('data', Buffer.from(options.body)); req.emit('end'); });
  });
}

test('accepts one signed exact-job wake and rejects overlap without polling', async () => {
  let release;
  const inFlight = new Promise(resolve => { release = resolve; });
  const jobs = [];
  const listener = createAgt002IncrementalWorkerDispatchServer({
    hmacSecret: SECRET,
    dispatchJob: async jobId => { jobs.push(jobId); await inFlight; return { status: 'completed' }; },
    logger: { info() {}, error() {} },
  });
  const url = `https://agt002.example${AGT002_INCREMENTAL_DISPATCH_PATH}`;
  const client = createAgt002IncrementalWorkerDispatchClient({ url, hmacSecret: SECRET, fetchImpl: inMemoryFetch(listener) });
  assert.deepEqual(await client.wake({ jobId: J1 }), { status: 'accepted' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await client.wake({ jobId: J2 }), { status: 'busy' });
  assert.deepEqual(jobs, [J1]);
  release();
});

test('fails closed for an invalid HMAC and never dispatches', async () => {
  let calls = 0;
  const listener = createAgt002IncrementalWorkerDispatchServer({
    hmacSecret: SECRET,
    dispatchJob: async () => { calls += 1; },
    logger: { info() {}, error() {} },
  });
  const url = `https://agt002.example${AGT002_INCREMENTAL_DISPATCH_PATH}`;
  const client = createAgt002IncrementalWorkerDispatchClient({
    url, hmacSecret: 'wrong-secret'.padEnd(40, 'z'), fetchImpl: inMemoryFetch(listener),
  });
  await assert.rejects(client.wake({ jobId: J1 }), /no aceptó/);
  assert.equal(calls, 0);
});
