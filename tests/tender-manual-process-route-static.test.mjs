// Contrato estático de la ruta que crea a mano un proceso que no está en SECOP (Juan, 2026-10-29), con la misma
// convención que tests/agt002-governed-document-worksets-route-static.test.mjs: recortar la ruta de los dos backends
// y afirmar sobre ella, además de pasar por el módulo puro.
//
// Lo que fija: las dos rutas (canónica y alias plano) declaradas en el inventario auditable; autenticar antes de
// autorizar y autorizar antes de tocar la base, con la MISMA acción que convertir desde el Radar; el responsable
// resuelto en el servidor y nunca leído del cuerpo; y que crear a mano no dispare importación de documentos ni
// trabajo de procesamiento, porque no hay fuente oficial de la cual importar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const root = path.resolve(import.meta.dirname, '..');

const serverSource = fs.readFileSync(path.join(root, 'server/index.js'));
const apiSource = fs.readFileSync(path.join(root, 'api/[...path].js'));
assert.ok(buffersAreEqual(serverSource, apiSource), 'server/index.js y api/[...path].js deben seguir siendo idénticos byte a byte');

for (const relative of ['server/index.js', 'api/[...path].js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');

  assert.match(source, /'POST \/api\/tenders\/manual': \['tenders', ACTIONS\.LICITACIONES_CONVERT\]/, `${relative} declara la ruta canónica en HTTP_ACTION_MATRIX`);
  assert.match(source, /'POST \/api\/tender-manual': \['tenders', ACTIONS\.LICITACIONES_CONVERT\]/, `${relative} declara el alias plano en HTTP_ACTION_MATRIX`);

  for (const route of ["app.post('/api/tenders/manual'", "app.post('/api/tender-manual'"]) {
    const start = source.indexOf(route);
    assert.ok(start >= 0, `${relative} debe exponer ${route}`);
    const end = source.indexOf('\napp.', start + 10);
    const block = source.slice(start, end < 0 ? source.length : end);

    const authIndex = block.indexOf('getAuthContext');
    const requireActionIndex = block.indexOf('requireAction(currentProfile, ACTIONS.LICITACIONES_CONVERT)');
    const databaseIndex = block.indexOf('requireDb()');
    assert.ok(authIndex >= 0, `${relative}: ${route} debe autenticar`);
    assert.ok(requireActionIndex > authIndex, `${relative}: ${route} debe exigir LICITACIONES_CONVERT justo después de autenticar`);
    assert.ok(databaseIndex > requireActionIndex, `${relative}: ${route} no debe tocar la base antes de autorizar`);
    assert.match(block, /createManualTenderProcess\(database, req\.body\?\.process \|\| req\.body, currentProfile\)/);
    // El responsable y el actor son del servidor: nunca se leen del cuerpo en la ruta.
    assert.doesNotMatch(block, /req\.body\.owner_id|req\.body\?\.owner_id|req\.body\.actor_id|req\.body\?\.actor_id/);
    assert.doesNotMatch(block, /database\.rpc\(/, `${relative}: ${route} nunca llama una RPC directamente`);
  }

  const fnStart = source.indexOf('async function createManualTenderProcess');
  assert.ok(fnStart >= 0, `${relative} debe definir createManualTenderProcess`);
  const fnBody = source.slice(fnStart, source.indexOf('\n}\n', fnStart));
  assert.match(fnBody, /tenderTableAvailable\(database\)/, `${relative}: el código tolera que la migración no haya corrido`);
  assert.match(fnBody, /callManualTenderOpportunityCreation\(database, \{ \.\.\.\(body \|\| \{\}\), owner_id: owner\.id \}, currentProfile\)/);
  // Crear a mano no importa documentos ni crea trabajo de procesamiento: no hay fuente oficial de la cual importar.
  assert.doesNotMatch(fnBody, /callCreateTenderProcessingJob|refreshTenderDocumentsFromOfficialSource|dispatchTenderProcessingAfterConversion/, `${relative}: crear a mano no dispara el pipeline de documentos`);
  assert.doesNotMatch(fnBody, /callTenderGoNoGoDecision|admitAgt002InitialAnalysis/, `${relative}: crear a mano no decide ni analiza por su cuenta`);

  const failureStart = source.indexOf('function manualTenderProcessFailure');
  assert.ok(failureStart >= 0, `${relative} debe traducir el fallo de la 165`);
  const failureBody = source.slice(failureStart, source.indexOf('\n}\n', failureStart));
  assert.match(failureBody, /PGRST202|42883/, `${relative}: la función que falta es una capacidad ausente, no un 400 de datos`);
  assert.match(failureBody, /unavailable\.status = 503/);
  assert.match(failureBody, /migración 165/);
}

console.log('contrato estático de la ruta de creación manual OK');
