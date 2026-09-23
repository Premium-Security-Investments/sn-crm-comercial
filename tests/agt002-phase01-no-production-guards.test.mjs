import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1');
const FIXTURES_DIR = path.join(CONTRACTS_DIR, 'fixtures');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

const EXECUTABLE_CONTROLS_PATH = path.join(REPO_ROOT, 'agt002-phase01-executable-controls.js');
const VALIDATE_FIXTURES_RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'agt002-phase01-validate-fixtures.mjs');

const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');
const AUTHORITY_REGISTRY_DATA_PATH = path.join(CONTRACTS_DIR, 'authority-registry.json');

const EXPECTATIONS = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));
const AUTHORITY_REGISTRY_DATA = JSON.parse(readFileSync(AUTHORITY_REGISTRY_DATA_PATH, 'utf8'));

function jsonFilesIn(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name));
}

function phase01TestFiles() {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.startsWith('agt002-phase01-') && name.endsWith('.test.mjs'))
    .map((name) => path.join(TESTS_DIR, name));
}

const THIS_FILE_PATH = fileURLToPath(import.meta.url);

const FIXTURE_JSON_FILES = jsonFilesIn(FIXTURES_DIR);
const CONTRACTS_JSON_FILES = [...jsonFilesIn(CONTRACTS_DIR), ...FIXTURE_JSON_FILES];
const IMPLEMENTATION_RUNNER_TEST_FILES = [
  EXECUTABLE_CONTROLS_PATH,
  VALIDATE_FIXTURES_RUNNER_PATH,
  // Excludes this guard file itself: it must legitimately quote these
  // forbidden substrings as pattern literals in order to check for them.
  ...phase01TestFiles().filter((filePath) => filePath !== THIS_FILE_PATH),
];

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

test('no production case names leak into fixtures or expectations', () => {
  const forbidden = /DANE|Fondo\s*[UÚuú]nico|Cali-Procuradur[ií]a|092/i;
  for (const filePath of FIXTURE_JSON_FILES) {
    const raw = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(raw, forbidden, `${path.basename(filePath)}: contains a forbidden production reference`);
  }
});

test('active_case is null on every gate fixture', () => {
  const gateRows = EXPECTATIONS.filter((entry) => entry.control === 'gate');
  assert.ok(gateRows.length > 0, 'expectations.json has no gate rows to check');
  for (const entry of gateRows) {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, entry.file), 'utf8'));
    assert.ok(
      Object.prototype.hasOwnProperty.call(fixture, 'active_case'),
      `${entry.file}: missing active_case`,
    );
    assert.equal(fixture.active_case, null, `${entry.file}: active_case must be null, got ${JSON.stringify(fixture.active_case)}`);
  }
});

test('synthetic principals are scoped to isolated_fixture only', () => {
  // The real authority-registry.json backs actual gates and must never grant a
  // synthetic principal access to production, regardless of what the
  // authority_registry negative fixtures (which deliberately model that
  // violation as INPUT data to prove the validator rejects it) contain.
  for (const grant of AUTHORITY_REGISTRY_DATA.grants) {
    if (grant.principal.principal_kind !== 'synthetic') continue;
    assert.deepEqual(
      grant.scope.environments,
      ['isolated_fixture'],
      `${grant.grant_id}: synthetic principal must be scoped to isolated_fixture only`,
    );
  }

  const gateRows = EXPECTATIONS.filter((entry) => entry.control === 'gate');
  for (const entry of gateRows) {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, entry.file), 'utf8'));
    if (fixture.authority.principal.principal_kind !== 'synthetic') continue;
    assert.equal(
      fixture.environment,
      'isolated_fixture',
      `${entry.file}: synthetic principal outside isolated_fixture`,
    );
  }
});

test('implementation, runner and Phase 0.1 test files never touch Supabase, mutators, network or the ambient clock', () => {
  // This exact pattern source is quoted verbatim, as a string literal, by
  // this test and by tests/agt002-phase01-schema-engine.test.mjs's own
  // source guard — strip that quoted literal before scanning so those
  // self-referential guard definitions don't trip over their own text.
  const forbiddenSource = '@supabase\\/supabase-js|createClient\\(|SUPABASE_SERVICE_ROLE_KEY|\\.insert\\(|\\.update\\(|\\.upsert\\(|\\.delete\\(|\\.rpc\\(|fetch\\(|node:https?|Date\\.now\\(\\)|new Date\\(\\)';
  const forbidden = new RegExp(forbiddenSource);
  for (const filePath of IMPLEMENTATION_RUNNER_TEST_FILES) {
    const raw = readFileSync(filePath, 'utf8').split(forbiddenSource).join('');
    assert.doesNotMatch(raw, forbidden, `${path.relative(REPO_ROOT, filePath)}: forbidden Supabase/mutator/network/clock usage`);
  }
});

test('no http(s) URLs, env keys or service role keys in contracts/agt002-phase01/v1', () => {
  const forbiddenSecrets = /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|ANON_KEY|process\.env/i;
  for (const filePath of CONTRACTS_JSON_FILES) {
    const raw = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(raw, forbiddenSecrets, `${path.relative(REPO_ROOT, filePath)}: contains an env key or service role key`);

    // $id/$schema are the only legitimate https:// values in this tree (JSON
    // Schema draft URIs); strip them before checking for URLs in the data.
    const parsed = JSON.parse(raw);
    if (Object.prototype.hasOwnProperty.call(parsed, '$id')) delete parsed.$id;
    if (Object.prototype.hasOwnProperty.call(parsed, '$schema')) delete parsed.$schema;
    const withoutSchemaMeta = JSON.stringify(parsed);
    assert.doesNotMatch(
      withoutSchemaMeta,
      /https?:\/\//i,
      `${path.relative(REPO_ROOT, filePath)}: contains an http(s) URL outside of $id/$schema`,
    );
  }
});

test('no fixture ever references a real production record: every UUID-shaped string is under the synthetic namespace', () => {
  for (const filePath of FIXTURE_JSON_FILES) {
    const raw = readFileSync(filePath, 'utf8');
    const matches = raw.match(UUID_PATTERN) ?? [];
    for (const uuid of matches) {
      assert.ok(
        uuid.toLowerCase().startsWith('f1c70000-'),
        `${path.basename(filePath)}: UUID "${uuid}" is not under the isolated_fixture synthetic namespace f1c70000- and could point to a real production record`,
      );
    }
  }
});
