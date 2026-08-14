import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buffersAreEqual} from '../scripts/check_backend_parity.mjs';

const serverSource=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const apiSource=readFileSync(new URL('../api/[...path].js',import.meta.url),'utf8');
const serverBuffer=readFileSync(new URL('../server/index.js',import.meta.url));
const apiBuffer=readFileSync(new URL('../api/[...path].js',import.meta.url));
const UUID_LITERAL=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function functionBlock(source,signature){const start=source.indexOf(signature); assert.ok(start>=0,`missing ${signature}`); const end=source.indexOf('\n}',start)+2; assert.ok(end>start+1); return source.slice(start,end);}
function assertBackend(source,label){
  assert.ok(source.includes("app.post('/api/agt002-reanalyze-fixed-snapshot', runAgt002ScheduledFixedSnapshotOperator);"),`${label}: existing scheduler route must remain`);
  assert.ok(source.includes("app.post('/api/internal/agt002-fixed-snapshot-reanalysis', runAgt002EphemeralFixedSnapshotOperator);"),`${label}: exact temporary route must exist`);
  const authorizer=functionBlock(source,'function isAgt002FixedCanarySecretAuthorized');
  assert.ok(authorizer.includes('secretMatches('));
  assert.ok(authorizer.includes('process.env.AGT002_FIXED_CANARY_SECRET'));
  assert.ok(authorizer.includes("req.headers['x-agt002-fixed-canary-secret']"));
  assert.ok(!authorizer.includes('console')); assert.ok(!UUID_LITERAL.test(authorizer));
  const core=functionBlock(source,'async function runAgt002FixedSnapshotOperator');
  assert.ok(core.includes('authorizeRequest(req)'),`${label}: operator must receive a route-scoped authorizer`);
  assert.ok(!core.includes('isAgt002FixedCanarySecretAuthorized'),`${label}: core must not OR ephemeral auth globally`);
  const scheduled=functionBlock(source,'function runAgt002ScheduledFixedSnapshotOperator');
  assert.ok(scheduled.includes('isTenderWorkerSchedulerAuthorized'));
  assert.ok(!scheduled.includes('isAgt002FixedCanarySecretAuthorized'));
  const ephemeral=functionBlock(source,'function runAgt002EphemeralFixedSnapshotOperator');
  assert.ok(ephemeral.includes('isAgt002FixedCanarySecretAuthorized'));
  assert.ok(!ephemeral.includes('isTenderWorkerSchedulerAuthorized'));
  const scheduler=functionBlock(source,'function isTenderWorkerSchedulerAuthorized');
  assert.ok(scheduler.includes('TENDER_WORKER_SCHEDULER_SECRET')&&scheduler.includes('CRON_SECRET'));
  assert.ok(!scheduler.includes('AGT002_FIXED_CANARY_SECRET'));
  const workbench=functionBlock(source,'function isAgt002WorkbenchWorkerAuthorized');
  assert.ok(workbench.includes('AGT002_WORKBENCH_WORKER_SECRET'));
  assert.ok(!workbench.includes('AGT002_FIXED_CANARY_SECRET'));
  assert.ok(source.includes('sanitizeAgt002FixedSnapshotError(error)'));
}
assertBackend(serverSource,'server/index.js'); assertBackend(apiSource,'api/[...path].js');
assert.ok(buffersAreEqual(serverBuffer,apiBuffer),'backends must remain byte-identical');
console.log('agt002 fixed-canary static isolation passed');
