import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const files = ['../api/[...path].js', '../server/index.js'].map(path =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
);

for (const source of files) {
  assert.match(source, /await importTenderDocumentsFromOfficialSource\(database, opportunityId, currentProfile, \{ analyze: true \}\)/);
  assert.match(source, /analysis_generated/);
  assert.match(source, /imported_count/);
  assert.match(source, /document_import_status = importResult\.analysis_generated \? 'analisis_generado' : 'fallo_importacion'/);
  assert.doesNotMatch(source, /await importTenderDocumentsFromOfficialSource[\s\S]{0,180}document_import_status = 'analisis_generado'/);
  assert.match(source, /kind: 'tender_document_import_error'/);
}

console.log('tender automatic analysis contract passed');
