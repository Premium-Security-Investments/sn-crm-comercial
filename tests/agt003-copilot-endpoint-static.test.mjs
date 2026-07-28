import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = [
  ['server', new URL('../server/index.js', import.meta.url)],
  ['vercel', new URL('../api/[...path].js', import.meta.url)],
];

for (const [name, url] of files) {
  const source = readFileSync(url, 'utf8');
  assert.ok(source.includes("from '../agt003-copilot-api.js'"), `${name} imports the shared API orchestrator`);
  assert.ok(source.includes("from '../agt003-copilot-runtime.js'"), `${name} imports the governed runtime`);
  assert.ok(source.includes("from '../agt003-copilot-persistence.js'"), `${name} imports append-only persistence`);
  assert.ok(source.includes("from '../vigia-approved-assets.js'"), `${name} imports the approved asset loader`);
  assert.ok(source.includes("'POST /api/vigia/copilot/generate': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN]"), `${name} inventories generation`);
  assert.ok(source.includes("'POST /api/vigia/copilot/feedback': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN]"), `${name} inventories feedback`);
  assert.ok(source.includes("app.post('/api/vigia/copilot/generate'"), `${name} exposes generation endpoint`);
  assert.ok(source.includes("app.post('/api/vigia/copilot/feedback'"), `${name} exposes feedback endpoint`);
  assert.ok(source.includes("app.all('/api/vigia/copilot/generate'"), `${name} rejects wrong generation methods`);
  assert.ok(source.includes("app.all('/api/vigia/copilot/feedback'"), `${name} rejects wrong feedback methods`);
  assert.ok(source.includes('VIGIA_COPILOT_OPPORTUNITY_SELECT'), `${name} uses an explicit opportunity allowlist`);
  assert.ok(source.includes("select('id,interaction_type,occurred_at,created_at,notes')"), `${name} uses an explicit interaction allowlist`);
  assert.ok(!source.includes("AGT003_COPILOT_API_KEY"), `${name} never receives a provider API key`);

  const generateStart = source.indexOf("app.post('/api/vigia/copilot/generate'");
  const generateEnd = source.indexOf("app.all('/api/vigia/copilot/generate'", generateStart);
  const generateRoute = source.slice(generateStart, generateEnd);
  assert.ok(generateRoute.indexOf('getAuthContext(req)') < generateRoute.indexOf('.generate('), `${name} authenticates before generation orchestration`);
  assert.ok(generateRoute.includes('body: req.body'), `${name} passes the untouched body to closed-body validation`);

  const feedbackStart = source.indexOf("app.post('/api/vigia/copilot/feedback'");
  const feedbackEnd = source.indexOf("app.all('/api/vigia/copilot/feedback'", feedbackStart);
  const feedbackRoute = source.slice(feedbackStart, feedbackEnd);
  assert.ok(feedbackRoute.indexOf('getAuthContext(req)') < feedbackRoute.indexOf('.feedback('), `${name} authenticates before feedback orchestration`);
  assert.ok(feedbackRoute.includes('body: req.body'), `${name} passes feedback to closed-body validation`);
}

console.log('AGT-003 copilot backend wiring contract passed');
