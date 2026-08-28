// TDD (RED) — paridad Express/serverless de la cobertura documental oficial.
//
// server/index.js y api/[...path].js son byte-identicos por contrato
// (scripts/check_backend_parity.mjs). Hoy AMBOS llevan la misma copia de
// `selectPriorityTenderDocuments`, con el catalogo fijo de palabras clave que
// descarta en silencio los documentos oficiales que no casan, en sus TRES
// puntos de uso: refresco SECOP II, refresco ESU y descubrimiento del worker
// durable (`buildTenderProcessingWorkerDeps().discoverDocuments`).
//
// Este archivo fija que la seleccion pase a ser una sola pieza compartida y
// auditable, en los dos backends a la vez, sin aflojar los controles SSRF ni la
// exposicion de texto/almacenamiento que ya existen en esa ruta.
//
// Ejecutar: node tests/tender-official-document-coverage-static.test.mjs

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverUrl = new URL('../server/index.js', import.meta.url);
const apiUrl = new URL('../api/[...path].js', import.meta.url);
const backends = [
  ['server/index.js', readFileSync(serverUrl, 'utf8')],
  ['api/[...path].js', readFileSync(apiUrl, 'utf8')],
];

// Paridad byte a byte: ninguna correccion puede aplicarse a un solo backend.
assert.equal(
  buffersAreEqual(readFileSync(serverUrl), readFileSync(apiUrl)),
  true,
  'server/index.js y api/[...path].js deben seguir siendo identicos byte a byte',
);

for (const [label, source] of backends) {
  // --- 1. El catalogo de palabras clave desaparece -------------------------
  assert.equal(
    /const priority = \['pliego'/.test(source),
    false,
    `${label}: el catalogo fijo de palabras clave no puede seguir decidiendo que documento oficial se importa`,
  );
  assert.equal(
    /selectPriorityTenderDocuments/.test(source),
    false,
    `${label}: la seleccion por prioridad de nombre debe retirarse por completo`,
  );

  // --- 2. Una sola pieza compartida, en los tres puntos de uso -------------
  assert.match(
    source,
    /import \{[^}]*selectTenderOfficialDocuments[^}]*\} from '\.\.\/tender-official-document-coverage\.js'/,
    `${label}: la cobertura documental oficial debe venir del modulo compartido`,
  );
  assert.match(
    source,
    /import \{[^}]*tenderOfficialCoverageGaps[^}]*\} from '\.\.\/tender-official-document-coverage\.js'/,
    `${label}: los gaps de cobertura deben derivarse del mismo modulo, no reimplementarse`,
  );
  assert.ok(
    (source.match(/selectTenderOfficialDocuments\(/g) || []).length >= 3,
    `${label}: los tres puntos de uso (SECOP II, ESU y descubrimiento durable) deben usar la seleccion compartida`,
  );

  // --- 3. La cobertura queda registrada y auditable ------------------------
  assert.match(
    source,
    /official_document_coverage/,
    `${label}: la cobertura documental oficial debe quedar registrada en la traza del refresco/descubrimiento`,
  );
  assert.match(
    source,
    /tenderOfficialCoverageGaps\(/,
    `${label}: los documentos omitidos deben convertirse en gaps explicitos, no desaparecer`,
  );
  assert.match(
    source,
    /kind: 'tender_document_refresh'/,
    `${label}: el refresco sincronico sigue dejando su interaccion append-only`,
  );

  // --- 4. Nada de lo ya blindado se afloja --------------------------------
  assert.match(source, /safeOfficialFetch/, `${label}: toda descarga oficial sigue pasando por safeOfficialFetch`);
  assert.match(source, /validateOfficialHttpsUrl/, `${label}: la validacion de host/ruta/DNS sigue vigente`);
  assert.equal(
    /downloadSecopDocument[\s\S]{0,350}fetch\(doc\.url_descarga_documento\.url/.test(source),
    false,
    `${label}: SECOP no puede volver a un fetch directo sobre la URL entregada por datos.gov`,
  );
  assert.equal(
    /downloadEsuDocument[\s\S]{0,300}fetch\(doc\.url/.test(source),
    false,
    `${label}: ESU no puede volver a un fetch directo sobre el href del HTML`,
  );
  assert.match(
    source,
    /tenderDocumentVersionPath|refreshOfficialTenderDocument/,
    `${label}: la ruta de almacenamiento versionada y saneada sigue siendo la unica via de subida`,
  );
  assert.match(
    source,
    /psi_begin_tender_document_refresh/,
    `${label}: la publicacion gobernada del snapshot no puede saltarse`,
  );
}

console.log('tender-official-document-coverage-static.test.mjs OK');
