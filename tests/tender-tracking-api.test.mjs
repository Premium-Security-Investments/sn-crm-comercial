import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

for (const path of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/tender-tracking'/);
  assert.match(source, /app\.get\('\/api\/tender-tracking-events'/);
  assert.match(source, /app\.post\('\/api\/tender-tracking-update'/);
  assert.match(source, /app\.post\('\/api\/tender-tracking-transition'/);
  assert.match(source, /psi_tender_tracking_events/);
  assert.match(source, /tracking_updated_at: now/);
  assert.match(source, /internal_status: 'en_revision'/);
}

console.log('tender tracking API contract passed');
