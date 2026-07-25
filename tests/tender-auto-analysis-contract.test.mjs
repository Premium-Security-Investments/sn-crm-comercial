import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const files = ['../api/[...path].js', '../server/index.js'].map(path =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
);

for (const source of files) {
  assert.match(source, /await refreshTenderDocumentsFromOfficialSource\(database, opportunityId, currentProfile, \{ analyze: true \}\)/);
  assert.match(source, /analysis_generated/);
  assert.match(source, /imported_count/);
  assert.match(source, /document_import_status = importResult\.analysis_generated \? 'analisis_generado' : 'fallo_importacion'/);
  assert.doesNotMatch(source, /await refreshTenderDocumentsFromOfficialSource[\s\S]{0,180}document_import_status = 'analisis_generado'/);
  const conversion = source.match(/async function convertTenderToOpportunity\([\s\S]*?\n}\nasync function markTenderOpportunityDiscarded/);
  assert.ok(conversion, 'convertTenderToOpportunity must be present');
  const guaranteedErrorAudits = conversion[0].match(/await must\(database\.from\('psi_sales_interactions'\)\.insert\(\{[\s\S]*?kind: 'tender_document_import_error'[\s\S]*?\}\)\.select\('id'\)\.single\(\)\);/g) || [];
  assert.equal(guaranteedErrorAudits.length, 2, 'both tender_document_import_error audit writes must use must(...select(\'id\').single())');
}

console.log('tender automatic analysis contract passed');
