import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Guardas estáticas a nivel fuente: el generador del manifiesto integral debe permanecer OFFLINE y
// read-only. Nunca importa Supabase, red o secretos; lee sólo los tres artefactos gobernados
// locales; aplica la guarda de PII antes de escribir; y sólo escribe los dos artefactos generados
// requeridos. Inspeccionamos la fuente, no la ejecutamos.
const source = readFileSync(new URL('../scripts/agt002-manizales-integral-manifest-generate.mjs', import.meta.url), 'utf8');

test('generator does not import Supabase, network or secrets', () => {
  assert.doesNotMatch(source, /@supabase/);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /\bfetch\b/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /SERVICE_ROLE|SUPABASE_URL|process\.env\.[A-Z]/);
});

test('generator reads exactly the three governed inputs and builds via the manifest module', () => {
  assert.match(source, /docs\/governance\/registro\/manizales-sa-24-2026\.registry\.json/);
  assert.match(source, /docs\/governance\/analisis\/manizales-sa-24-2026\.pre-go-analysis\.json/);
  assert.match(source, /docs\/governance\/propuestas\/manizales-sa-24-2026\.section-proposals\.json/);
  assert.match(source, /from '\.\.\/agt002-manizales-integral-manifest\.js'/);
  assert.match(source, /buildAgt002ManizalesIntegralManifest/);
  // no other JSON inputs are read
  const reads = source.match(/readFileSync\([A-Z_]+_JSON/g) || [];
  assert.equal(reads.length, 3);
});

test('generator validates and applies the PII guard before writing', () => {
  const validateIdx = source.indexOf('validateAgt002ManizalesIntegralManifest(manifest)');
  const piiIdx = source.indexOf('assertNoOpenPii(manifest)');
  const writeIdx = source.indexOf('writeFileSync(OUTPUT_JSON');
  assert.ok(validateIdx > -1, 'debe validar el artefacto');
  assert.ok(piiIdx > -1, 'debe llamar assertNoOpenPii');
  assert.ok(writeIdx > -1, 'debe escribir el artefacto');
  assert.ok(validateIdx < writeIdx && piiIdx < writeIdx, 'valida y aplica PII antes de escribir');
});

test('generator writes only the three required generated artifacts', () => {
  assert.match(source, /data\/agt002\/manizales-sa-24-2026\.integral-manifest\.v1\.json/);
  assert.match(source, /docs\/governance\/manizales-sa-24-2026\.integral-manifest-consolidated\.md/);
  assert.match(source, /docs\/governance\/manizales-sa-24-2026\.integral-manifest-corrections\.json/);
  const writes = source.match(/writeFileSync\(/g) || [];
  assert.equal(writes.length, 3, 'exactamente tres escrituras (manifiesto, consolidado, correcciones)');
  assert.doesNotMatch(source, /supabase|migrations|rollbacks|\.env/);
});

test('generator applies the deterministic mechanical corrections pass before validating', () => {
  assert.match(source, /applyManizalesManifestCorrections/);
  assert.match(source, /buildManizalesManifestCorrectionsArtifact/);
  const correctIdx = source.indexOf('applyManizalesManifestCorrections(built)');
  const validateIdx = source.indexOf('validateAgt002ManizalesIntegralManifest(manifest)');
  assert.ok(correctIdx > -1 && validateIdx > -1);
  assert.ok(correctIdx < validateIdx, 'corrige antes de validar el artefacto final');
});
