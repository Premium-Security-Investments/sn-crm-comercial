import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function extractCanonicalRoute(source) {
  const start = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  const end = source.indexOf("\n});", start);
  return start >= 0 && end > start ? source.slice(start, end + 4) : '';
}

test('canonical preview route emits only the safe staged unavailable event with a correlation id', () => {
  assert.equal(server, api, 'production backends must remain byte-identical');
  const route = extractCanonicalRoute(server);
  assert.ok(route, 'canonical preview route must exist');
  assert.match(route, /randomUUID\(\)/u);
  assert.match(route, /AGT002_CANONICAL_PREVIEW_STAGES\.RUNTIME_CONFIG/u);
  assert.match(route, /AGT002_CANONICAL_PREVIEW_STAGES\.GOVERNANCE/u);
  assert.match(route, /AGT002_CANONICAL_PREVIEW_STAGES\.RUNTIME_CREATION/u);
  assert.match(route, /AGT002_CANONICAL_PREVIEW_STAGES\.ENGINE_ANALYSIS/u);
  assert.match(route, /canonical_preview_unavailable/u);
  assert.match(route, /bridge_invocation_started/u);
  assert.doesNotMatch(route, /canonical_preview_unavailable[\s\S]{0,500}error_message/u);
  assert.doesNotMatch(route, /canonical_preview_unavailable[\s\S]{0,500}error\.message/u);
  assert.doesNotMatch(route, /canonical_preview_unavailable[\s\S]{0,500}error\.stack/u);
});
