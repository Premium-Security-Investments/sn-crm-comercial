import { strict as assert } from 'node:assert';
import { runInConcurrentChunks } from '../tender-concurrency.js';

let active = 0;
let maxActive = 0;
const completed = [];
const items = Array.from({ length: 13 }, (_, index) => index + 1);

const results = await runInConcurrentChunks(items, 5, async item => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise(resolve => setTimeout(resolve, 5));
  completed.push(item);
  active -= 1;
  return item * 2;
});

assert.equal(maxActive, 5, 'concurrency must be bounded to the configured chunk size');
assert.equal(active, 0, 'all in-flight work must finish before returning');
assert.equal(completed.length, items.length, 'every item must be processed');
assert.deepEqual(results, items.map(item => item * 2), 'results must preserve input order across chunks');
await assert.rejects(() => runInConcurrentChunks(items, 0, async item => item), /limit >= 1/);

console.log('tender concurrency contract passed');
