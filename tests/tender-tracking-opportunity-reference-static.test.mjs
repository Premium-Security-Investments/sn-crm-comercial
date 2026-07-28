import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

for (const relative of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /async function getTenderTrackingTender\(database, tenderReferenceId\)/, `${relative}: el resolver debe aceptar una referencia pública o de oportunidad`);
  assert.match(source, /\.or\(`id\.eq\.\$\{tenderReferenceId\},converted_opportunity_id\.eq\.\$\{tenderReferenceId\}`\)/, `${relative}: debe resolver por id público o converted_opportunity_id`);
  assert.match(source, /const tender = await getTenderTrackingTender\(database, tenderId\);[\s\S]{0,900}\.eq\('tender_id', tender\.id\)/, `${relative}: el historial debe consultar el tender canónico`);
  assert.match(source, /const tender = await getTenderTrackingTender\(database, tenderId\);[\s\S]{0,700}p_tender_id: tender\.id/, `${relative}: la actuación debe escribirse sobre el tender canónico`);
}

console.log('tender tracking opportunity reference static contract passed');
