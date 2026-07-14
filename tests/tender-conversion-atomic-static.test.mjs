import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const shared = readFileSync(new URL('../tender-tracking-rpc.js', import.meta.url), 'utf8');
assert.match(shared, /export async function callTenderOpportunityConversion/);
assert.match(shared, /rpc\(database, 'psi_convert_tender_to_opportunity'/);
assert.match(shared, /p_tender_id: id/);
assert.match(shared, /p_external_source: payload\.external_source/);
assert.match(shared, /p_owner_id: ownerId/);
for (const column of ['company_name', 'stage_code', 'service_type_code', 'offer_value', 'expected_close_date', 'quote_city', 'regional_nombre', 'sede', 'economic_sector', 'tipo_producto_original', 'observaciones', 'external_source']) {
  assert.match(shared, new RegExp(`p_${column}: payload\\.${column}`), `wrapper must forward ${column}`);
}

for (const path of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /callTenderOpportunityConversion/);
  const conversion = source.match(/async function convertTenderToOpportunity\([\s\S]*?\n}\nasync function markTenderOpportunityDiscarded/);
  assert.ok(conversion, 'conversion handler must exist');
  assert.match(conversion[0], /callTenderOpportunityConversion\(database, tenderRecord\.id, payload,/);
  assert.doesNotMatch(conversion[0], /\.from\('psi_sales_opportunities'\)\.insert/);
  assert.doesNotMatch(conversion[0], /\.from\('psi_sales_opportunities'\)\.select\('id'\)\.eq\('external_source'/);
  assert.doesNotMatch(conversion[0], /markTenderConverted/);
  assert.match(conversion[0], /await importTenderDocumentsFromOfficialSource\(database, opportunityId, currentProfile, \{ analyze: true \}\)/);
}

console.log('atomic tender conversion handler contract passed');
