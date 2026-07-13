import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/main.tsx', 'utf8');

const requiredConstants = [
  'TENDER_SYNC_CONFIRMATION',
  'TENDER_DISCARD_CONFIRMATION',
  'TENDER_IMPORT_DOCUMENTS_CONFIRMATION',
  'TENDER_ANALYZE_DOCUMENTS_CONFIRMATION',
  'TENDER_APPROVE_PREPARATION_CONFIRMATION',
  'TENDER_OPPORTUNITY_DISCARD_CONFIRMATION',
];
for (const name of requiredConstants) {
  assert.match(source, new RegExp(`const ${name} = `), `${name} must be centralized`);
}

const guardedFlows = [
  ['refreshRadar', 'TENDER_SYNC_CONFIRMATION', '/api/tender-refresh'],
  ['markTenderStatus', 'TENDER_DISCARD_CONFIRMATION', '/api/tender-status'],
  ['importOfficialDocuments', 'TENDER_IMPORT_DOCUMENTS_CONFIRMATION', '/api/tender-documents-import'],
  ['analyzeDocuments', 'TENDER_ANALYZE_DOCUMENTS_CONFIRMATION', '/api/tender-documents-analyze'],
  ['approvePreparation', 'TENDER_APPROVE_PREPARATION_CONFIRMATION', '/api/tender-offer-preparation-approve'],
  ['discardTenderOpportunity', 'TENDER_OPPORTUNITY_DISCARD_CONFIRMATION', '/api/tender-opportunity-discard'],
];
for (const [fn, constant, endpoint] of guardedFlows) {
  const start = source.indexOf(`const ${fn} = async`);
  assert.notEqual(start, -1, `${fn} handler must exist`);
  const body = source.slice(start, start + 900);
  assert.match(body, new RegExp(`window\\.confirm\\(${constant}[^)]*\\)`), `${fn} must confirm with ${constant}`);
  assert.match(body, /if \(!(?:ok|confirmed)\) return;/, `${fn} must return when cancelled`);
  assert.ok(body.includes(endpoint), `${fn} must still call ${endpoint}`);
}

for (const phrase of [
  'fuentes oficiales',
  'descartar',
  'documentos oficiales',
  'análisis documental',
  'Expediente de Oferta',
  'Sacar de oportunidad',
]) {
  assert.match(source, new RegExp(phrase, 'i'), `confirmation copy should mention ${phrase}`);
}

console.log('tender sensitive confirmations OK');
