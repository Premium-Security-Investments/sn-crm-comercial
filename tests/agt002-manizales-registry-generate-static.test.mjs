import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Static source-level guards: the generator must stay OFFLINE and read-only. It never imports
// Supabase, never touches the network/secrets, applies the PII guard before writing, and
// writes only under docs/governance/registro. We inspect the source, we do not run it.
const source = readFileSync(new URL('../scripts/agt002-manizales-registry-generate.mjs', import.meta.url), 'utf8');

test('generator does not import Supabase, network or secrets', () => {
  assert.doesNotMatch(source, /@supabase/);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /\bfetch\b/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /SERVICE_ROLE|SUPABASE_URL|process\.env/);
});

test('generator reads the offline export and builds via the registry module', () => {
  assert.match(source, /\/tmp\/agt002-rama-originals/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /extraction-manifest\.json/);
  assert.match(source, /from '\.\.\/agt002-contractual-registry\.js'/);
  assert.match(source, /buildContractualRegistry/);
});

test('generator applies the PII guard before writing the open artifact', () => {
  const guardIdx = source.indexOf('assertNoOpenPii(registry)');
  const writeIdx = source.indexOf('writeFileSync(OUTPUT_JSON');
  assert.ok(guardIdx > -1, 'must call assertNoOpenPii');
  assert.ok(writeIdx > -1, 'must write the artifact');
  assert.ok(guardIdx < writeIdx, 'PII guard must run before writing the artifact');
});

test('generator writes only under docs/governance/registro', () => {
  assert.match(source, /docs\/governance\/registro\/manizales-sa-24-2026\.registry\.json/);
  assert.match(source, /docs\/governance\/registro\/2026-08-12-manizales-registro-contractual-cobertura\.md/);
  // Main is guarded so importing/reading the module has no side effects.
  assert.match(source, /if \(process\.argv\[1\] === fileURLToPath\(import\.meta\.url\)\)/);
});
