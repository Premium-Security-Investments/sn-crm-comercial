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

function loadPublicInteractionPreparation(source, path) {
  const implementation = source.match(/const RESERVED_TENDER_INTERACTION_KINDS = new Set\([\s\S]*?\);\nfunction assertPublicInteractionPayload\(notes\) \{[\s\S]*?\n\}\nfunction preparePublicInteractionNotes\(notes\) \{[\s\S]*?\n\}/);
  assert.ok(implementation, `${path} must define the public interaction note preparation helper`);
  return new Function('parseInteractionJson', `${implementation[0]}\nreturn preparePublicInteractionNotes;`)(parseInteractionJson);
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
  const preparePublicInteractionNotes = loadPublicInteractionPreparation(source, path);
  const helperStart = source.indexOf('function preparePublicInteractionNotes(notes) {');
  const helperEnd = source.indexOf('\n}\nfunction normalizeDocumentType', helperStart);
  const helperBody = source.slice(helperStart, helperEnd + 2);
  assert.ok(helperBody.indexOf('assertPublicInteractionPayload(notes);') < helperBody.indexOf('JSON.stringify(notes)'), `${path} must guard raw notes before serializing object notes`);

  for (const kind of reservedKinds) {
    for (const notes of [JSON.stringify({ kind }), { kind }]) {
      assert.throws(
        () => preparePublicInteractionNotes(notes),
        (error) => error?.status === 403 && /ruta interna autorizada/i.test(error.message),
        `${path} must reject ${kind} from generic interaction notes in ${typeof notes} form`,
      );
    }
  }

  assert.equal(
    preparePublicInteractionNotes({ kind: 'seguimiento', note: 'Llamar mañana.' }),
    JSON.stringify({ kind: 'seguimiento', note: 'Llamar mañana.' }),
    `${path} must serialize non-reserved structured notes after guarding their raw value`,
  );
  assert.equal(preparePublicInteractionNotes('  Seguimiento comercial ordinario.  '), 'Seguimiento comercial ordinario.', `${path} must preserve ordinary seguimiento notes`);
  assert.equal(preparePublicInteractionNotes('  {not valid JSON  '), '{not valid JSON', `${path} must preserve malformed user text that is not an internal object`);
  assert.throws(() => preparePublicInteractionNotes('   '), /nota del seguimiento es obligatoria/i, `${path} must require nonempty notes`);

  for (const route of ['/api/opportunities/:id/interactions', '/api/opportunity-interactions']) {
    const body = routeBody(source, route);
    const prepareCall = body.indexOf('const notes = preparePublicInteractionNotes(req.body.notes);');
    const insert = body.indexOf("psi_sales_interactions').insert(row)");
    assert.ok(prepareCall >= 0, `${path} must call preparePublicInteractionNotes directly with raw req.body.notes in ${route}`);
    assert.ok(insert >= 0 && prepareCall < insert, `${path} must prepare generic ${route} notes before its insert`);
    assert.doesNotMatch(body, /String\(req\.body\.notes/, `${path} must not stringify req.body.notes before the generic ${route} guard`);
  }

  let inserts = 0;
  assert.throws(() => {
    const notes = preparePublicInteractionNotes({ kind: reservedKinds[0] });
    inserts += 1;
    return notes;
  }, (error) => error?.status === 403, `${path} must fail preparation before a generic insert can execute`);
  assert.equal(inserts, 0, `${path} must prevent a reserved object payload from reaching a generic insert`);

  for (const route of ['/api/tender-documents-upload', '/api/tender-documents-analyze']) {
    const body = routeBody(source, route);
    assert.doesNotMatch(body, /assertPublicInteractionPayload|preparePublicInteractionNotes/, `${path} must leave authorized ${route} writes available`);
  }
}

console.log('tender internal interaction kinds passed');
