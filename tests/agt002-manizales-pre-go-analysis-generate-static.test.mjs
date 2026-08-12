import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Guardas estáticas a nivel fuente: el generador pre-GO debe permanecer OFFLINE y read-only.
// Nunca importa Supabase, red o secretos; aplica la guarda de PII antes de escribir; y sólo
// escribe bajo docs/governance/analisis. Inspeccionamos la fuente, no la ejecutamos.
const source = readFileSync(new URL('../scripts/agt002-manizales-pre-go-analysis-generate.mjs', import.meta.url), 'utf8');

test('generator does not import Supabase, network or secrets', () => {
  assert.doesNotMatch(source, /@supabase/);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /\bfetch\b/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /SERVICE_ROLE|SUPABASE_URL|process\.env\.[A-Z]/);
});

test('generator reads only local governed artifacts and builds via the pre-GO module', () => {
  assert.match(source, /docs\/governance\/registro\/manizales-sa-24-2026\.registry\.json/);
  assert.match(source, /docs\/governance\/drafts\/agt002-rama-judicial/);
  assert.match(source, /from '\.\.\/agt002-pre-go-analysis\.js'/);
  assert.match(source, /buildAgt002PreGoAnalysis/);
});

test('generator keeps legal verification gated locally (no invented corpus)', () => {
  assert.match(source, /LEGAL_CORPUS_VERSION_LOCAL\s*=\s*null/);
  assert.match(source, /legalCorpusVersion:\s*LEGAL_CORPUS_VERSION_LOCAL/);
});

test('generator applies the PII guard and structural validation before writing', () => {
  const validateIdx = source.indexOf('validateAgt002PreGoAnalysis(artifact)');
  const piiIdx = source.indexOf('assertNoOpenPii(artifact)');
  const writeIdx = source.indexOf('writeFileSync(OUTPUT_JSON');
  assert.ok(validateIdx > -1, 'debe validar el artefacto');
  assert.ok(piiIdx > -1, 'debe llamar assertNoOpenPii');
  assert.ok(writeIdx > -1, 'debe escribir el artefacto');
  assert.ok(piiIdx < writeIdx, 'la guarda de PII corre antes de escribir');
});

test('generator writes only under docs/governance/analisis', () => {
  assert.match(source, /docs\/governance\/analisis\/manizales-sa-24-2026\.pre-go-analysis\.json/);
  assert.match(source, /docs\/governance\/analisis\/2026-08-12-manizales-pre-go-analisis\.md/);
  assert.doesNotMatch(source, /writeFileSync\([^,)]*(?<!analisis[^,)]*)\b(supabase|dist|src)\b/);
});
