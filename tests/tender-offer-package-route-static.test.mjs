// Contrato estático del paquete de la oferta (punto 3 del encargo del 2026-10-30).
//
// Lo que fija, y es la mitad del diseño: la ruta **no devuelve bytes ni URLs firmadas**. El navegador baja cada
// archivo por su propia ruta, que vuelve a autorizar; la respuesta de esta ruta sólo lleva la lista, el índice y la
// matriz, y no se guarda en ninguna caché. También fija que reusa el puente y la matriz en vez de recalcular, y que
// el ZIP se arma en el navegador.
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

  assert.match(source, /'GET \/api\/tender-offer-package': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/, `${relative} declara la ruta en HTTP_ACTION_MATRIX`);

  const start = source.indexOf("app.get('/api/tender-offer-package'");
  assert.ok(start >= 0, `${relative} debe exponer la ruta del paquete`);
  const end = source.indexOf('\napp.', start + 10);
  const route = source.slice(start, end < 0 ? source.length : end);
  const authIndex = route.indexOf('getAuthContext');
  const requireActionIndex = route.indexOf('requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW)');
  assert.ok(authIndex >= 0 && requireActionIndex > authIndex, `${relative}: autorizar justo después de autenticar`);
  assert.ok(route.indexOf('requireDb()') > requireActionIndex, `${relative}: no tocar la base antes de autorizar`);
  // La lista de lo que va a radicarse no se cachea en ninguna parte.
  assert.match(route, /Cache-Control', 'private, no-store'/);
  assert.doesNotMatch(route, /req\.body/);

  const fnStart = source.indexOf('async function readTenderOfferPackage');
  assert.ok(fnStart >= 0, `${relative} debe definir readTenderOfferPackage`);
  const fnBody = source.slice(fnStart, source.indexOf('\n}\n', fnStart));

  // Reusa el puente y la matriz: una sola verdad para la carpeta de cada documento y para la matriz del paquete.
  assert.match(fnBody, /readTenderCompanyDocumentBridge\(database, opportunityId, currentProfile\)/);
  assert.match(fnBody, /readTenderComplianceMatrix\(database, opportunityId, currentProfile\)/);
  assert.match(fnBody, /buildTenderOfferPackageManifest\(\{/);
  assert.match(fnBody, /tenderOfferPackageIndex\(manifest\)/);
  assert.match(fnBody, /tenderComplianceMatrixCsv\(matrix\.headers, matrix\.table\)/);
  // Sólo lectura, y sin firmar nada en el cuerpo.
  assert.doesNotMatch(fnBody, /createSignedUrl|signedUrl/, `${relative}: la capacidad de bajar no viaja en el cuerpo`);
  assert.doesNotMatch(fnBody, /database\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/, `${relative}: el paquete nunca escribe`);
  assert.doesNotMatch(fnBody, /content_base64|arrayBuffer|Buffer\.from/, `${relative}: los bytes no pasan por esta ruta`);
}

// El ZIP se arma en el navegador, con el módulo neutro.
const panel = fs.readFileSync(path.join(root, 'src/tenders/components/TenderOfferPackagePanel.tsx'), 'utf8');
assert.match(panel, /import \{ zipStore \} from '\.\.\/\.\.\/\.\.\/verticales\/licitaciones\/zip-store\.js'/);
assert.match(panel, /apiDownload\(`\/api\/tender-documents\/\$\{encodeURIComponent\(file\.document_id\)\}\/download\?opportunity_id=/);
assert.match(panel, /folders: paquete\.manifest\.folders/, 'las doce carpetas entran al ZIP');
assert.match(panel, /00_Control\/02_NO_SE_PUDIERON_BAJAR\.md/, 'un archivo que no se pudo bajar se anota, no se calla');

// El módulo del ZIP es neutro: nada de Node, para que corra en el navegador.
const zipModule = fs.readFileSync(path.join(root, 'verticales/licitaciones/zip-store.js'), 'utf8');
for (const forbidden of [/^import[^\n]*node:/m, /\brequire\(/, /\bBuffer\b/, /\bprocess\./]) {
  assert.doesNotMatch(zipModule, forbidden, `zip-store debe ser neutro (${forbidden})`);
}

const packageModule = fs.readFileSync(path.join(root, 'verticales/licitaciones/tender-offer-package.js'), 'utf8');
for (const forbidden of [/^import[^\n]*@supabase/m, /\bfetch\(/, /\bdatabase\./]) {
  assert.doesNotMatch(packageModule, forbidden, `el módulo del paquete es puro (${forbidden})`);
}

console.log('contrato estático del paquete de la oferta OK');
