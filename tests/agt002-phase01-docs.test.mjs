import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs', 'agt002', 'phase01');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1');
const FIXTURES_DIR = path.join(CONTRACTS_DIR, 'fixtures');

const BINDING_INVENTORY_PATH = path.join(DOCS_DIR, 'binding-inventory.md');
const GATE_CATALOG_PATH = path.join(DOCS_DIR, 'gate-catalog.md');
const FINDINGS_INDEX_PATH = path.join(DOCS_DIR, 'findings-index.md');
const BINDING_REGISTRY_PATH = path.join(CONTRACTS_DIR, 'binding-registry.json');
const GATE_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'gate.schema.json');

const DOC_FILES = [
  ['binding-inventory.md', BINDING_INVENTORY_PATH],
  ['gate-catalog.md', GATE_CATALOG_PATH],
  ['findings-index.md', FINDINGS_INDEX_PATH],
];

const FORBIDDEN_MARKERS = /TODO|TBD|FIXME|placeholder|CONTRADICTIONS\.md#/i;

function readDoc(docPath) {
  assert.ok(existsSync(docPath), `${path.relative(REPO_ROOT, docPath)} must exist`);
  return readFileSync(docPath, 'utf8');
}

const FACT_IDS = Array.from({ length: 11 }, (_, i) => `AGT002-P1-FACT-${String(i + 1).padStart(4, '0')}`);
const GAP_IDS = Array.from({ length: 4 }, (_, i) => `AGT002-P1-GAP-${String(i + 1).padStart(4, '0')}`);
const EXPECTED_FINDING_IDS = [...FACT_IDS, ...GAP_IDS];

function collectFactAndGapIds(node, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectFactAndGapIds(item, out);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'fact_id' || key === 'gap_id') && typeof value === 'string') {
      out.add(value);
    }
    collectFactAndGapIds(value, out);
  }
}

test('docs/agt002/phase01 binding-inventory.md, gate-catalog.md and findings-index.md exist and carry no TODO/TBD/FIXME/placeholder/dangling-CONTRADICTIONS markers', () => {
  for (const [name, docPath] of DOC_FILES) {
    const content = readDoc(docPath);
    assert.doesNotMatch(
      content,
      FORBIDDEN_MARKERS,
      `${name} must not contain TODO/TBD/FIXME/placeholder or a dangling CONTRADICTIONS.md# reference`,
    );
  }
});

test('findings-index.md declares exactly the 15 normative AGT002-P1-FACT/GAP ids, matching fact_id/gap_id values found across binding-registry.json and fixtures/*.json', () => {
  const content = readDoc(FINDINGS_INDEX_PATH);

  const idPattern = /(?<!\d)AGT002-P1-(?:FACT|GAP)-\d{4}(?!\d)/g;
  const matches = content.match(idPattern) ?? [];
  assert.equal(matches.length, EXPECTED_FINDING_IDS.length, 'findings-index.md must reference exactly 15 AGT002-P1-FACT/GAP ids in total');

  const counts = new Map();
  for (const id of matches) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of EXPECTED_FINDING_IDS) {
    assert.equal(counts.get(id), 1, `findings-index.md must reference ${id} exactly once`);
  }

  const registryFiles = [
    BINDING_REGISTRY_PATH,
    ...readdirSync(FIXTURES_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(FIXTURES_DIR, name)),
  ];

  const normativeIds = new Set();
  for (const filePath of registryFiles) {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    collectFactAndGapIds(data, normativeIds);
  }

  assert.deepEqual(
    [...normativeIds].sort(),
    [...EXPECTED_FINDING_IDS].sort(),
    'the set of fact_id/gap_id values found in binding-registry.json and fixtures/*.json must equal the 15 normative ids',
  );
});

test('gate-catalog.md sections match gate.schema.json properties.type.enum exactly and each declares a skill-contract', () => {
  const content = readDoc(GATE_CATALOG_PATH);
  const gateSchema = JSON.parse(readFileSync(GATE_SCHEMA_PATH, 'utf8'));
  const expectedTypes = gateSchema.properties.type.enum;

  const headerPattern = /^##\s+([A-Z0-9_]+)\s*$/gm;
  const headerMatches = [...content.matchAll(headerPattern)];
  const headers = headerMatches.map((m) => m[1]);

  assert.deepEqual(
    [...headers].sort(),
    [...expectedTypes].sort(),
    'gate-catalog.md ## sections must match gate.schema.json properties.type.enum exactly',
  );

  const skillContractPattern = /skill-contract:[a-z0-9.-]+/;
  for (let i = 0; i < headerMatches.length; i += 1) {
    const start = headerMatches[i].index;
    const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index : content.length;
    const section = content.slice(start, end);
    assert.match(
      section,
      skillContractPattern,
      `gate-catalog.md section "${headers[i]}" must declare a skill-contract:[a-z0-9.-]+ reference`,
    );
  }
});

test('binding-inventory.md contains the literal live schema facts and gap ids', () => {
  const content = readDoc(BINDING_INVENTORY_PATH);
  const requiredLiterals = [
    'psi_public_tenders.converted_opportunity_id',
    'psi_sales_opportunities.id',
    'psi_public_tenders_converted_opportunity_id_unique',
    '/rest/v1/psi_public_tenders',
    'AGT002-P1-GAP-0001',
    'AGT002-P1-GAP-0002',
    'psi_agt002_radar_gate_evaluations',
  ];
  for (const literal of requiredLiterals) {
    assert.ok(content.includes(literal), `binding-inventory.md must contain literal "${literal}"`);
  }
});

test('binding-inventory.md contains the literal cutoff_utc declared in binding-registry.json', () => {
  const bindingRegistryData = JSON.parse(readFileSync(BINDING_REGISTRY_PATH, 'utf8'));
  const cutoffs = new Set(bindingRegistryData.bindings.map((binding) => binding.cutoff_utc));
  assert.equal(cutoffs.size, 1, 'binding-registry.json must declare a single consistent cutoff_utc across all bindings');
  const [cutoffUtc] = cutoffs;

  const content = readDoc(BINDING_INVENTORY_PATH);
  assert.ok(content.includes(cutoffUtc), `binding-inventory.md must contain the literal cutoff_utc "${cutoffUtc}"`);
});

test('.claude/skills is absent or has no uncommitted changes', () => {
  const skillsDir = path.join(REPO_ROOT, '.claude', 'skills');
  if (!existsSync(skillsDir)) {
    assert.ok(true);
    return;
  }

  const result = spawnSync('git', ['status', '--porcelain', '.claude/skills'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git status failed: ${result.stderr}`);
  assert.equal(result.stdout.trim(), '', '.claude/skills must have no uncommitted changes');
});
