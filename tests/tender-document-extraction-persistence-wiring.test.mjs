import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = readFileSync(join(root, 'server/index.js'), 'utf8');
const api = readFileSync(join(root, 'api/[...path].js'), 'utf8');

assert.equal(server, api, 'los backends serverless y local deben permanecer byte-identical');
for (const source of [server, api]) {
  assert.match(source, /includeExtractedText = false/, 'la lectura pública debe ser segura por defecto');
  assert.match(source, /from\('psi_tender_document_extractions'\)/, 'el backend debe consultar las extracciones versionadas');
  assert.match(source, /selectCanonicalExtractionsByDocumentVersion/, 'el backend debe seleccionar una extracción canónica');
  assert.match(source, /mergeCanonicalExtractionIntoDocument/, 'los consumidores internos deben recibir el texto canónico');
  assert.match(source, /documents: includeExtractedText \? signed : signed\.map\(publicTenderDocumentProjection\)/, 'la respuesta pública debe omitir el texto integral');
  assert.match(source, /extractText: extractTypedTextFromTenderFile/, 'la importación oficial debe conservar el resultado tipado');
  assert.match(source, /recordExtraction: \(\{ extraction, version \}\)/, 'la importación oficial debe persistir la extracción tras crear la versión');
  assert.match(source, /loadCurrentDocuments:[\s\S]{0,240}includeExtractedText: true/, 'el replay fijo debe cargar texto canónico');
}

function collectJavaScriptFiles(directory) {
  const output = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) output.push(...collectJavaScriptFiles(path));
    else if (/\.(?:js|jsx|ts|tsx)$/.test(name)) output.push(path);
  }
  return output;
}

for (const path of collectJavaScriptFiles(join(root, 'src'))) {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /tender-document-extraction-persistence|psi_tender_document_extractions/, `${path} no debe importar la implementación ni tabla de texto integral`);
}

console.log('tender document extraction persistence wiring contract passed');
