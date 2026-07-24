import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const backendPaths = ['../server/index.js', '../api/[...path].js'];
const reservedKinds = [
  'tender_document_upload',
  'tender_document_analysis',
  'tender_document_import_error',
  'tender_document_clarification',
  'tender_offer_preparation',
];

function parseInteractionJson(notes) {
  try { return JSON.parse(notes || '{}'); } catch { return null; }
}

function loadPublicInteractionGuard(source, path) {
  const implementation = source.match(/const RESERVED_TENDER_INTERACTION_KINDS = new Set\(\[[\s\S]*?\]\);\nfunction assertPublicInteractionPayload\(notes\) \{[\s\S]*?\n\}/);
  assert.ok(implementation, `${path} must define the reserved tender interaction guard`);
  return new Function('parseInteractionJson', `${implementation[0]}\nreturn assertPublicInteractionPayload;`)(parseInteractionJson);
}

function routeBody(source, route) {
  const start = source.indexOf(`app.post('${route}'`);
  assert.notEqual(start, -1, `missing ${route}`);
  const end = source.indexOf('\n});', start);
  assert.notEqual(end, -1, `unterminated ${route}`);
  return source.slice(start, end + 4);
}

for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const assertPublicInteractionPayload = loadPublicInteractionGuard(source, path);

  for (const kind of reservedKinds) {
    assert.throws(
      () => assertPublicInteractionPayload(JSON.stringify({ kind })),
      (error) => error?.status === 403 && /ruta interna autorizada/i.test(error.message),
      `${path} must reject ${kind} from a generic interaction payload`,
    );
  }

  assert.doesNotThrow(() => assertPublicInteractionPayload('Seguimiento comercial ordinario.'), `${path} must preserve ordinary seguimiento notes`);
  assert.doesNotThrow(() => assertPublicInteractionPayload('{not valid JSON'), `${path} must preserve malformed user text that is not an internal object`);
  assert.doesNotThrow(() => assertPublicInteractionPayload(JSON.stringify({ kind: 'seguimiento', note: 'Llamar mañana.' })), `${path} must preserve non-reserved structured notes`);

  for (const route of ['/api/opportunities/:id/interactions', '/api/opportunity-interactions']) {
    const body = routeBody(source, route);
    assert.match(body, /const notes = String\(req\.body\.notes \|\| ''\)\.trim\(\);[\s\S]*?assertPublicInteractionPayload\(notes\);[\s\S]*?psi_sales_interactions'\)\.insert\(row\)/, `${path} must guard ${route} before its generic insert`);
  }

  for (const route of ['/api/tender-documents-upload', '/api/tender-documents-analyze']) {
    const body = routeBody(source, route);
    assert.doesNotMatch(body, /assertPublicInteractionPayload/, `${path} must leave authorized ${route} writes available`);
  }
}

console.log('tender internal interaction kinds passed');
