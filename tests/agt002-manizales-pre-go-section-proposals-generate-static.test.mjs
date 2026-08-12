import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Guardas estáticas a nivel fuente: el generador de propuestas debe permanecer OFFLINE y
// read-only. Nunca importa Supabase, red o secretos; aplica la guarda de PII antes de escribir;
// y sólo escribe bajo docs/governance/propuestas. Inspeccionamos la fuente, no la ejecutamos.
const source = readFileSync(new URL('../scripts/agt002-manizales-pre-go-section-proposals-generate.mjs', import.meta.url), 'utf8');

test('generator does not import Supabase, network or secrets', () => {
  assert.doesNotMatch(source, /@supabase/);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /\bfetch\b/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /SERVICE_ROLE|SUPABASE_URL|process\.env\.[A-Z]/);
});

test('generator reads only the local registry and builds via the proposals module', () => {
  assert.match(source, /docs\/governance\/registro\/manizales-sa-24-2026\.registry\.json/);
  assert.match(source, /from '\.\.\/agt002-pre-go-section-proposals\.js'/);
  assert.match(source, /buildAgt002PreGoSectionProposals/);
});

test('generator validates and applies the PII guard before writing', () => {
  const validateIdx = source.indexOf('validateAgt002PreGoSectionProposals(artifact)');
  const piiIdx = source.indexOf('assertNoOpenPii(artifact)');
  const writeIdx = source.indexOf('writeFileSync(OUTPUT_JSON');
  assert.ok(validateIdx > -1, 'debe validar el artefacto');
  assert.ok(piiIdx > -1, 'debe llamar assertNoOpenPii');
  assert.ok(writeIdx > -1, 'debe escribir el artefacto');
  assert.ok(piiIdx < writeIdx, 'la guarda de PII corre antes de escribir');
});

test('generator writes only under docs/governance/propuestas', () => {
  assert.match(source, /docs\/governance\/propuestas\/manizales-sa-24-2026\.section-proposals\.json/);
  assert.match(source, /docs\/governance\/propuestas\/2026-08-12-manizales-pre-go-propuestas\.md/);
  assert.doesNotMatch(source, /writeFileSync\([^,)]*(?<!propuestas[^,)]*)\b(supabase|dist|src)\b/);
});
