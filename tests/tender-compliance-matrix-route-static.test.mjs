// Contrato estático de la matriz de cumplimiento (punto 2 del encargo del 2026-10-30).
//
// Lo que fija: la ruta en el inventario auditable; autenticar → autorizar → leer; que sea de SÓLO LECTURA; que los
// requisitos salgan del MISMO modelo con el que se siembra el expediente (`buildRequirementRows`), para que la matriz
// y el expediente no puedan discrepar; que sin análisis terminado responda `available:false` en vez de una matriz
// vacía que se leería como "no hay requisitos"; y que no dependa del expediente ni del GO.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const root = path.resolve(import.meta.dirname, '..');
assert.ok(
  buffersAreEqual(fs.readFileSync(path.join(root, 'server/index.js')), fs.readFileSync(path.join(root, 'api/[...path].js'))),
  'server/index.js y api/[...path].js deben seguir siendo idénticos byte a byte',
);

for (const relative of ['server/index.js', 'api/[...path].js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');

  assert.match(source, /'GET \/api\/tender-compliance-matrix': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/, `${relative} declara la ruta en HTTP_ACTION_MATRIX`);

  const start = source.indexOf("app.get('/api/tender-compliance-matrix'");
  assert.ok(start >= 0, `${relative} debe exponer la ruta de la matriz`);
  const end = source.indexOf('\napp.', start + 10);
  const route = source.slice(start, end < 0 ? source.length : end);
  const authIndex = route.indexOf('getAuthContext');
  const requireActionIndex = route.indexOf('requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW)');
  assert.ok(authIndex >= 0 && requireActionIndex > authIndex, `${relative}: autorizar justo después de autenticar`);
  assert.ok(route.indexOf('requireDb()') > requireActionIndex, `${relative}: no tocar la base antes de autorizar`);
  assert.doesNotMatch(route, /req\.body/, `${relative}: es una lectura, no acepta cuerpo`);

  const fnStart = source.indexOf('async function readTenderComplianceMatrix');
  assert.ok(fnStart >= 0, `${relative} debe definir readTenderComplianceMatrix`);
  const fnBody = source.slice(fnStart, source.indexOf('\n}\n', fnStart));

  // Los requisitos salen del mismo modelo del sembrado del expediente, sobre el reporte canónico.
  assert.match(fnBody, /readAgt002InitialAnalysisReport\(database, opportunityId\)/);
  assert.match(fnBody, /buildTenderComplianceMatrix\(\{ requirementRows: buildRequirementRows\(report\.report\), bridge \}\)/);
  // Sin análisis: available:false con su motivo, no una matriz vacía.
  assert.match(fnBody, /available: false, reason: 'sin_analisis_terminado'/);
  // Reusa el puente, así que hereda su guardia de oportunidad y su fecha de cierre con fuente declarada.
  assert.match(fnBody, /readTenderCompanyDocumentBridge\(database, opportunityId, currentProfile\)/);
  // Sólo lectura, y nada del expediente ni del GO.
  assert.doesNotMatch(fnBody, /database\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/, `${relative}: la matriz nunca escribe`);
  assert.doesNotMatch(fnBody, /psi_assert_tender_dossier_go|getTenderDossierWorkspace/, `${relative}: la matriz no depende del expediente ni del GO`);
}

const matrixModule = fs.readFileSync(path.join(root, 'verticales/licitaciones/tender-compliance-matrix.js'), 'utf8');
for (const forbidden of [/^import[^\n]*@supabase/m, /^import[^\n]*'express'/m, /\bfetch\(/, /\bdatabase\./]) {
  assert.doesNotMatch(matrixModule, forbidden, `el módulo de la matriz es puro (${forbidden})`);
}
// El cruce con la ficha de empresa se declara con palabras, no se adivina con un modelo.
assert.match(matrixModule, /TENDER_COMPLIANCE_DOCUMENT_HINTS/);

console.log('contrato estático de la matriz de cumplimiento OK');
