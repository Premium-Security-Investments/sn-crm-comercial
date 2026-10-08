import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['server/index.js', 'api/[...path].js']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const route = source.match(/app\.post\('\/api\/agt002-incremental-company-evidence-links'[\s\S]*?\n\}\);/i)?.[0] || '';
  assert.ok(route, `${file}: company evidence link route must exist`);
  assert.match(route, /ensureTenderOpportunity\(database, opportunityId, profile\)/);
  assert.match(route, /psi_agt002_company_evidence_registry/);
  assert.match(route, /buildAgt002CompanyEvidenceLinkSignalContent\(entry\)/);
  assert.match(route, /triggerKind: 'company_evidence_link'/);
  assert.match(route, /ingestAgt002AuthorizedHumanSignals/);
  assert.doesNotMatch(route, /\.update\(|\.upsert\(|\.insert\(/,
    `${file}: linking may append only through the R1 signal ledger and must never write registry 061`);
}

console.log('AGT-002 incremental company-evidence link API contract passed');
