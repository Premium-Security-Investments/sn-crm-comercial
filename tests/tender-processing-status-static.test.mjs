import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));
const typesSource = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');

function extractRouteHandler(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `no se encontró la ruta ${marker}`);
  const braceStart = source.indexOf('{', markerIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(markerIndex, i + 1);
    }
  }
  throw new Error(`no se pudo balancear el handler de ${marker}`);
}

function assertBackend(source, label) {
  const handler = extractRouteHandler(source, "app.get('/api/tender-processing-status'");
  assert.ok(handler.includes('requireTenderTrackingAccess(currentProfile)'), `${label}: falta el guard de acceso de seguimiento`);
  assert.ok(!handler.includes(".select('*')"), `${label}: debe usar una whitelist explícita de columnas, no select('*')`);
  assert.ok(handler.includes('documents_imported'), `${label}: falta el conteo de documentos importados`);
  assert.ok(handler.includes('documents_failed'), `${label}: falta el conteo de documentos fallidos`);
  assert.ok(handler.includes(".from('psi_tender_document_snapshots')"), `${label}: debe consultar el snapshot más reciente de la oportunidad`);
  assert.match(handler, /psi_tender_document_snapshots'[\s\S]*?\.select\('id'\)[\s\S]*?\.eq\('opportunity_id', opportunityId\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)[\s\S]*?\.limit\(1\)[\s\S]*?\.maybeSingle\(\)/, `${label}: debe resolver el snapshot más reciente sin exponerlo`);
  assert.ok(handler.includes('isTenderProcessingJobSuperseded(data.snapshot_id, latestSnapshot?.id)'), `${label}: debe derivar superseded comparando el snapshot del job con el vigente`);
  assert.match(handler, /job_id: null[\s\S]*?superseded: false/, `${label}: no_job debe responder superseded false`);
  assert.match(handler, /superseded,[\s\S]*?updated_at:/, `${label}: el job debe exponer solo el booleano superseded`);
  assert.ok(!handler.includes('extracted_text'), `${label}: no debe exponer extracted_text`);
  assert.ok(!/[^_]result[^s]/.test(handler.replace(/importResult|refreshResults|updateResult|eventResult/g, '')), `${label}: no debe exponer un resultado crudo del proveedor`);
  assert.ok(!handler.includes('usage'), `${label}: no debe exponer uso crudo del proveedor`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  assert.match(typesSource, /TenderProcessingStatus\s*=\s*\{[^}]*superseded:\s*boolean;/, 'El contrato TypeScript debe declarar superseded como boolean obligatorio');
  console.log('tender-processing-status-static passed');
}
run();
