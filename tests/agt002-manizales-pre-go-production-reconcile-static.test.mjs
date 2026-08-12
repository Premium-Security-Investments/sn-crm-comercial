import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Guardas estáticas a nivel fuente: el reconciliador PRODUCTIVO debe permanecer READ-ONLY.
// Nunca invoca verbos de escritura ni select('*'); usa el select allowlisted existente; carga
// env sin imprimir secretos; y sólo escribe artefactos sanitarios bajo docs/governance/analisis.
// Inspeccionamos la fuente, no la ejecutamos contra producción.
const source = readFileSync(new URL('../scripts/agt002-manizales-pre-go-production-reconcile.mjs', import.meta.url), 'utf8');

// Cuerpo ejecutable, sin comentarios ni literales de la allowlist/guardián, para que las
// prohibiciones no colisionen con la propia lista de métodos prohibidos que el guardián declara.
function executableBody(text) {
  return text
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}
const body = executableBody(source);

test('reconciler never calls a write/verb method on the client', () => {
  // Ninguna invocación de método de escritura: .insert( / .update( / .upsert( / .delete( / .rpc( / .storage
  for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.doesNotMatch(body, new RegExp(`\\.\\s*${verb}\\s*\\(`), `no debe invocar .${verb}(`);
  }
  assert.doesNotMatch(body, /\.\s*storage\b/, 'no debe usar .storage');
  assert.doesNotMatch(body, /\.\s*from\s*\([^)]*\)\s*\.\s*(insert|update|upsert|delete)/, 'no debe encadenar escritura tras .from()');
});

test('reconciler never uses select(*)', () => {
  assert.doesNotMatch(body, /select\(\s*['"`]\s*\*/, 'select(*) prohibido');
  assert.doesNotMatch(body, /select\(\s*['"`][^'"`]*\*/, 'select con comodín prohibido');
});

test('reconciler uses the existing allowlisted loaders, not ad-hoc selects', () => {
  assert.match(source, /loadAgt002CompanyEvidenceRegistryEntries/);
  assert.match(source, /loadPublishedAgt002LegalCorpus/);
  assert.match(source, /buildAgt002CompanyEvidenceClasses/);
  assert.match(source, /buildAgt002PreGoAnalysis/);
  // No debe declarar sus propios .from(...).select(...) crudos: los selects viven en los loaders.
  assert.doesNotMatch(body, /\.from\s*\([^)]*\)\s*\.\s*select\s*\(/, 'no debe hacer selects crudos; usa los loaders allowlisted');
});

test('reconciler wraps the client in a read-only guard passed to the loaders', () => {
  assert.match(source, /createReadOnlyClientGuard/);
  assert.match(source, /FORBIDDEN_DB_METHODS/);
  // El cliente que reciben los loaders es el guardado, no el crudo.
  assert.match(body, /loadAgt002CompanyEvidenceRegistryEntries\(guarded\)/);
  assert.match(body, /loadPublishedAgt002LegalCorpus\(guarded\)/);
});

test('reconciler loads env without printing secrets and requires an env file flag', () => {
  assert.match(source, /--env-file/);
  assert.match(source, /persistSession:\s*false/);
  // No debe imprimir process.env de credenciales ni el serviceKey.
  assert.doesNotMatch(body, /console\.log\([^)]*SERVICE_ROLE/i);
  assert.doesNotMatch(body, /(stdout|stderr|console)\.[a-z]+\([^)]*serviceKey/);
  assert.doesNotMatch(body, /(stdout|stderr|console)\.[a-z]+\([^)]*process\.env/);
});

test('reconciler shows legal verification only from a validated published corpus version, never content', () => {
  assert.match(source, /legalCorpusVersion:\s*legalCorpus\.corpus_version/);
  // No debe ACCEDER al contenido jurídico de las fuentes (texto/artículos/URLs/autoridad) para
  // pasarlo al análisis ni persistirlo. (Los mismos tokens aparecen sólo como literales en la
  // allowlist de claves prohibidas del guardián sanitario, nunca como accesos de propiedad.)
  assert.doesNotMatch(body, /\.current_text\b/);
  assert.doesNotMatch(body, /\.official_url\b/);
  assert.doesNotMatch(body, /\.issuing_authority\b/);
});

test('reconciler runs sanitary guards before writing and writes only under analisis', () => {
  const assertPiiIdx = source.indexOf('assertNoOpenPii(summary)');
  const assertSanitaryIdx = source.indexOf('assertSanitaryReconcileMetadataOnly(summary)');
  const writeIdx = source.indexOf('writeFileSync(OUTPUT_JSON');
  assert.ok(assertPiiIdx > -1 && assertSanitaryIdx > -1, 'debe aplicar ambas guardas sanitarias');
  assert.ok(writeIdx > -1, 'debe poder escribir el artefacto');
  assert.ok(assertPiiIdx < writeIdx && assertSanitaryIdx < writeIdx, 'las guardas corren antes de escribir');
  assert.match(source, /docs\/governance\/analisis\/manizales-sa-24-2026\.pre-go-production-reconcile\.json/);
  assert.match(source, /docs\/governance\/analisis\/2026-08-12-manizales-pre-go-production-reconcile\.md/);
});

test('reconciler does not touch the offline generator or its artifacts', () => {
  // En el cuerpo ejecutable (la cabecera de comentarios sí nombra el generador offline sólo
  // para contrastar): no lee/escribe el artefacto offline ni invoca su generador.
  assert.doesNotMatch(body, /pre-go-analysis\.json/, 'no debe escribir/leer el artefacto offline');
  assert.doesNotMatch(body, /agt002-manizales-pre-go-analysis-generate/, 'no debe invocar el generador offline');
});

console.log('agt002-manizales-pre-go-production-reconcile-static.test.mjs OK');
