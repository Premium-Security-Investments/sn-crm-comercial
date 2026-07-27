import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));

function extractFunctionBody(source, functionName) {
  const marker = `async function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `no se encontró ${functionName} en el archivo`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`no se pudo balancear el cuerpo de ${functionName}`);
}

function extractDurableBranch(functionBody) {
  const marker = 'isTenderDurablePipelineEnabled(process.env)) {';
  const markerIndex = functionBody.indexOf(marker);
  assert.ok(markerIndex >= 0, 'no se encontró la rama isTenderDurablePipelineEnabled');
  const braceStart = markerIndex + marker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < functionBody.length; i += 1) {
    if (functionBody[i] === '{') depth += 1;
    else if (functionBody[i] === '}') {
      depth -= 1;
      if (depth === 0) return functionBody.slice(braceStart, i + 1);
    }
  }
  throw new Error('no se pudo balancear la rama durable');
}

function assertBackend(source, label) {
  assert.ok(source.includes("from '../tender-durable-flags.js'"), `${label}: falta import de tender-durable-flags.js`);
  assert.ok(source.includes('callCreateTenderProcessingJob'), `${label}: falta la llamada al wrapper psi_create_tender_processing_job`);
  assert.ok(source.includes('processing:'), `${label}: la respuesta no expone la clave processing`);

  const body = extractFunctionBody(source, 'convertTenderToOpportunity');
  assert.ok(body.includes('isTenderDurablePipelineEnabled(process.env)'), `${label}: falta la rama durable`);
  assert.ok(body.includes('isTenderTrackableStatus'), `${label}: se perdió el guard de estado terminal`);

  const durableBranch = extractDurableBranch(body);
  assert.ok(!durableBranch.includes('refreshTenderDocumentsFromOfficialSource'), `${label}: la rama durable no debe importar documentos síncronamente`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-convert-durable-static passed');
}
run();
