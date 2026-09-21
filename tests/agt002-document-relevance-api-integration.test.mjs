// Cableado del backend para AGT-002 "Sugerido por Vig-IA"
// (.hermes/plans/2026-09-21-vigia-document-preselection.md, pieza 4).
//
// Este corte no crea ningun endpoint nuevo: extiende la respuesta EXISTENTE de
// documentos vigentes (la que ya arma getTenderDocumentRecords y proyecta con
// publicTenderDocumentProjection) para que cada documento publico traiga tambien
// analysis_suggestion, calculado por el servidor con el documento completo del
// lado servidor — nunca con el documento ya proyectado/recortado.
//
// Tres afirmaciones:
//   1. Cableado de fuente: los dos backends importan suggestAgt002DocumentRelevance
//      desde ../agt002-document-relevance-suggestion.js (misma profundidad relativa
//      en server/ y en api/) y anotan cada documento con analysis_suggestion antes
//      de proyectarlo, pasandole el documento completo, no el ya proyectado.
//   2. Los dos backends siguen siendo la misma fuente (convenio de paridad del
//      repo: byte-identical una vez normalizados los finales de linea).
//   3. tender-document-extraction-persistence.js agrega analysis_suggestion a su
//      lista blanca de campos publicos, y extracted_text sigue, sin excepcion,
//      fuera de ella.
//   4. Runtime: publicTenderDocumentProjection conserva exactos los valores
//      seguros de un analysis_suggestion suministrado, pero despoja de el
//      extracted_text/token/source_url anidados que un extra malicioso intente
//      colar adentro, y nunca expone el extracted_text de nivel superior del
//      documento.
//
// Ejecutar: node tests/agt002-document-relevance-api-integration.test.mjs

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { publicTenderDocumentProjection } from '../tender-document-extraction-persistence.js';

const root = new URL('../', import.meta.url);

// "Convenio de paridad" del repo: los dos backends son byte-identical (ver
// tests/agt002-analysis-config-wiring.test.mjs y tests/security/tender-api-projection.test.mjs).
// Se normalizan los finales de linea antes de comparar para no acoplar la prueba
// a la convencion de finales de linea del checkout, no porque el repo tolere
// backends divergentes.
const normalizeForParity = text => text.replace(/\r\n/g, '\n');

const server = readFileSync(new URL('server/index.js', root), 'utf8');
const api = readFileSync(new URL('api/[...path].js', root), 'utf8');

// ===========================================================================
// 1 y 2. Cableado de fuente e importacion, sobre los dos backends.
// ===========================================================================
{
  assert.equal(
    normalizeForParity(server),
    normalizeForParity(api),
    'server/index.js y api/[...path].js deben permanecer byte-identical (tras normalizar finales de linea)',
  );

  for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
    assert.match(
      source,
      /import \{ suggestAgt002DocumentRelevance \} from '\.\.\/agt002-document-relevance-suggestion\.js';/,
      `${label} debe importar suggestAgt002DocumentRelevance desde ../agt002-document-relevance-suggestion.js`,
    );

    // La linea que hoy produce la respuesta publica de documentos, capturada sin
    // depender de su numero de linea.
    const documentsLine = source.match(
      /documents:\s*includeExtractedText\s*\?\s*compatibleDocuments\s*:\s*compatibleDocuments\.map\(document\s*=>\s*publicTenderDocumentProjection\([\s\S]*?\)\),/,
    );
    assert.ok(documentsLine, `${label} debe seguir construyendo la respuesta publica de documentos a partir de compatibleDocuments`);
    const block = documentsLine[0];

    assert.match(
      block,
      /suggestAgt002DocumentRelevance\(document\)/,
      `${label} debe anotar cada documento llamando a suggestAgt002DocumentRelevance con el documento completo del lado servidor (no el ya proyectado)`,
    );
    assert.match(
      block,
      /analysis_suggestion:\s*suggestAgt002DocumentRelevance\(document\)/,
      `${label} debe asignar el resultado de suggestAgt002DocumentRelevance a la clave analysis_suggestion`,
    );
    assert.match(
      block,
      /\.\.\.document/,
      `${label} debe seguir pasando el documento completo (spread) a publicTenderDocumentProjection, no un subconjunto`,
    );

    // La anotacion ocurre ANTES de proyectar: publicTenderDocumentProjection debe
    // recibir ya el objeto con analysis_suggestion, no anotarse despues.
    const projectionCallIndex = block.indexOf('publicTenderDocumentProjection(');
    const suggestionCallIndex = block.indexOf('suggestAgt002DocumentRelevance(document)');
    assert.ok(
      suggestionCallIndex > projectionCallIndex && suggestionCallIndex < block.indexOf(', { opportunityId }'),
      `${label} debe anotar analysis_suggestion dentro del objeto pasado a publicTenderDocumentProjection, antes de proyectarlo`,
    );
  }
}

// ===========================================================================
// 3. Lista blanca: analysis_suggestion entra, extracted_text sigue afuera.
// ===========================================================================
{
  const persistenceSource = readFileSync(new URL('tender-document-extraction-persistence.js', root), 'utf8');
  const whitelist = persistenceSource.match(/const PUBLIC_TENDER_DOCUMENT_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(whitelist, 'debe existir la lista blanca de campos publicos del documento');

  assert.match(
    whitelist[1],
    /'analysis_suggestion'/,
    'analysis_suggestion debe agregarse a la lista blanca de campos publicos del documento',
  );
  assert.doesNotMatch(
    whitelist[1],
    /'extracted_text'/,
    'extracted_text nunca debe entrar a la lista blanca de campos publicos del documento',
  );
}

// ===========================================================================
// 4. Runtime: publicTenderDocumentProjection con un analysis_suggestion real.
// ===========================================================================
{
  const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';

  const SAFE_SUGGESTION = Object.freeze({
    recommended: true,
    confidence: 'high',
    reason_code: 'document_type_and_name_match',
    reason: 'El tipo documental y el nombre de archivo coinciden con el pliego vigente.',
    policy_version: 'agt002-document-relevance-v1',
  });

  const TOP_LEVEL_SECRET = 'CONFIDENCIAL: nunca debe salir por el nivel superior del documento.';
  const NESTED_SECRET_TEXT = 'CONFIDENCIAL: texto filtrado dentro de analysis_suggestion.';
  const NESTED_TOKEN = 'CAPACIDAD-FILTRADA-DENTRO-DE-SUGGESTION';
  const NESTED_SOURCE_URL = 'https://community.secop.gov.co/Public/Descarga?docId=9&token=FIRMA-SECRETA-ANIDADA';

  const maliciousSuggestion = {
    ...SAFE_SUGGESTION,
    // Extras maliciosos que un payload historico o un bug rio arriba podria
    // colar DENTRO de analysis_suggestion, no en el nivel superior del documento.
    extracted_text: NESTED_SECRET_TEXT,
    token: NESTED_TOKEN,
    source_url: NESTED_SOURCE_URL,
  };

  const projected = publicTenderDocumentProjection({
    id: 'doc-1',
    name: 'Pliego de condiciones.pdf',
    document_type: 'pliego',
    extracted_text: TOP_LEVEL_SECRET,
    analysis_suggestion: maliciousSuggestion,
  }, { opportunityId: OPPORTUNITY_ID });

  assert.deepEqual(
    projected.analysis_suggestion,
    SAFE_SUGGESTION,
    'la proyeccion publica debe conservar exactos los valores seguros de analysis_suggestion y despojar cualquier extra anidado',
  );
  assert.equal(
    'extracted_text' in projected,
    false,
    'la proyeccion publica nunca puede exponer el extracted_text de nivel superior del documento',
  );

  const serialized = JSON.stringify(projected);
  for (const secret of [TOP_LEVEL_SECRET, NESTED_SECRET_TEXT, NESTED_TOKEN, 'FIRMA-SECRETA-ANIDADA']) {
    assert.equal(serialized.includes(secret), false, `la proyeccion publica no puede serializar ${secret}`);
  }
}

console.log('tests/agt002-document-relevance-api-integration.test.mjs OK');
