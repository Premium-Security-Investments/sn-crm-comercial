// Contrato estático de la ruta del puente ficha de empresa → expediente (encargo del 2026-10-30).
//
// Lo que fija: la ruta declarada en el inventario auditable; autenticar → autorizar → leer, con el permiso de ver
// Licitaciones y el guardia de oportunidad de licitación; que sea de SÓLO LECTURA (ni RPC, ni insert, ni update); que
// la fecha de cierre la resuelva el servidor con su fuente declarada y no la acepte del cliente; y que no dependa del
// expediente ni, por tanto, del GO — saber qué falta antes de decidir es justo para lo que sirve.
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

  assert.match(source, /'GET \/api\/tender-dossier-company-documents': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/, `${relative} declara la ruta en HTTP_ACTION_MATRIX`);

  const start = source.indexOf("app.get('/api/tender-dossier-company-documents'");
  assert.ok(start >= 0, `${relative} debe exponer la ruta del puente`);
  const end = source.indexOf('\napp.', start + 10);
  const route = source.slice(start, end < 0 ? source.length : end);

  const authIndex = route.indexOf('getAuthContext');
  const requireActionIndex = route.indexOf('requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW)');
  const databaseIndex = route.indexOf('requireDb()');
  assert.ok(authIndex >= 0 && requireActionIndex > authIndex, `${relative}: autorizar justo después de autenticar`);
  assert.ok(databaseIndex > requireActionIndex, `${relative}: no tocar la base antes de autorizar`);
  assert.match(route, /readTenderCompanyDocumentBridge\(database, opportunityId, currentProfile\)/);
  assert.doesNotMatch(route, /req\.body/, `${relative}: es una lectura, no acepta cuerpo`);

  const fnStart = source.indexOf('async function readTenderCompanyDocumentBridge');
  assert.ok(fnStart >= 0, `${relative} debe definir readTenderCompanyDocumentBridge`);
  const fnBody = source.slice(fnStart, source.indexOf('\n}\n', fnStart));

  // El guardia de siempre: acceso a la oportunidad y que sea de licitación pública.
  assert.match(fnBody, /ensureTenderOpportunity\(database, opportunityId, currentProfile\)/);
  // La fecha de cierre la resuelve el servidor, con la canónica de la licitación primero y su fuente declarada.
  assert.match(fnBody, /resolveCanonicalTenderDeadline\(tender\)/);
  assert.match(fnBody, /close_date_source: tenderDeadline \? 'licitacion' : opportunity\.expected_close_date \? 'oportunidad' : null/);
  // Sólo lectura: nada de RPC ni de escrituras, y nada del expediente (que exigiría el GO).
  assert.doesNotMatch(fnBody, /database\.rpc\(/, `${relative}: el puente no llama ninguna RPC`);
  assert.doesNotMatch(fnBody, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, `${relative}: el puente nunca escribe`);
  assert.doesNotMatch(fnBody, /psi_get_tender_dossier_workspace|psi_assert_tender_dossier_go|getTenderDossierWorkspace/, `${relative}: el puente no depende del expediente ni del GO`);
  // El cálculo vive en el módulo puro, no en la ruta.
  assert.match(fnBody, /buildTenderCompanyDocumentBridge\(\{ registry: companyBase\.registry, documents, closeDate \}\)/);
}

const bridgeModule = fs.readFileSync(path.join(root, 'verticales/licitaciones/tender-company-document-bridge.js'), 'utf8');
// La prueba mira las importaciones y las llamadas, no el texto de los comentarios: el encabezado del módulo dice
// "sin express" y eso no puede hacerla fallar.
for (const forbidden of [/^import[^\n]*@supabase/m, /^import[^\n]*'express'/m, /^import[^\n]*node:(http|https|net)/m, /\bfetch\(/, /\bdatabase\./]) {
  assert.doesNotMatch(bridgeModule, forbidden, `el módulo del puente es puro: sin red, sin base de datos (${forbidden})`);
}
assert.match(bridgeModule, /TENDER_COMPANY_DOCUMENT_CLASSES/);

console.log('contrato estático de la ruta del puente ficha de empresa → expediente OK');
