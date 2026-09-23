import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_REASON_CODES,
  AGT002_PHASE01_REASON_CATALOG,
  AGT002_PHASE01_SCHEMA_VERSIONS,
  validateAgt002Phase01GateTransition,
  resolveAgt002Phase01Authority,
  validateAgt002Phase01ValidLink,
  evaluateAgt002Phase01Fixture,
} from '../agt002-phase01-executable-controls.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1');
const EXECUTABLE_CONTROLS_PATH = path.join(REPO_ROOT, 'agt002-phase01-executable-controls.js');
const FIXTURES_DIR = path.join(CONTRACTS_DIR, 'fixtures');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');
const BINDING_REGISTRY_DATA_PATH = path.join(CONTRACTS_DIR, 'binding-registry.json');
const AUTHORITY_REGISTRY_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'authority-registry.schema.json');

const EXPECTATIONS = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));
const BINDING_REGISTRY_DATA = JSON.parse(readFileSync(BINDING_REGISTRY_DATA_PATH, 'utf8'));
const AUTHORITY_REGISTRY_SCHEMA = JSON.parse(readFileSync(AUTHORITY_REGISTRY_SCHEMA_PATH, 'utf8'));

const NOW_UTC = '2026-09-23T18:00:00Z';

// The 17 mandatory negative rows from the plan's Task 8 table. The 4
// compound negatives (#2, #5, #6, #13) keep both codes in one row, but each
// code is asserted on its own below.
const REQUIRED_NEGATIVES = Object.freeze([
  { id: 'missing_required_field', codes: ['schema.missing_required'] },
  { id: 'incorrect_or_nonexistent_authority', codes: ['authority.grant.not_found', 'authority.grant.gate_type_mismatch'] },
  { id: 'expired_delegation', codes: ['authority.delegation.expired'] },
  { id: 'expired_gate', codes: ['gate.status.open_but_expired'] },
  { id: 'revoked_gate', codes: ['gate.status.revocation_required', 'gate.transition.not_allowed'] },
  { id: 'consumed_gate_reconsumption', codes: ['gate.consumption.exceeds_policy', 'gate.consumption.receipt_not_unique'] },
  { id: 'incorrect_hash', codes: ['gate.artifact_set_hash.mismatch'] },
  { id: 'ids_out_of_scope', codes: ['authority.scope.resource_out_of_scope'] },
  { id: 'zero_links', codes: ['link.cardinality.zero'] },
  { id: 'multiple_links', codes: ['link.cardinality.multiple'] },
  { id: 'incompatible_link', codes: ['link.binding.incompatible'] },
  { id: 'conflicting_identity', codes: ['link.identity.conflict'] },
  { id: 'closed_or_discarded_opportunity', codes: ['link.opportunity.closed', 'link.opportunity.discarded'] },
  { id: 'non_durable_evidence', codes: ['link.evidence.not_durable'] },
  { id: 'non_exhaustive_query', codes: ['link.query.not_exhaustive'] },
  { id: 'unlinked_term_a', codes: ['link.term_a.entity_l_absent'] },
  { id: 'absent_o_tender_id', codes: ['link.term_b.literal_fk_absent'] },
]);

// Codes not covered by any fixture in expectations.json (Tasks 4.7, 3.5 and
// 6.10 assert these inline, never as fixtures under fixtures/**).
const INLINE_NEGATIVES = Object.freeze({
  'authority.grant.gate_type_mismatch': () => {
    const registry = {
      schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.authorityRegistry,
      registry_version: 1,
      supersedes_registry_version: null,
      issued_at_utc: '2026-09-01T00:00:00Z',
      grants: [
        {
          grant_id: 'GRANT-NEGATIVE-MATRIX-0001',
          gate_type: 'PHASE_AUDIT',
          principal: {
            principal_id: 'f1c70000-0000-0000-0000-000000000010',
            principal_kind: 'synthetic',
            durable_ref: {
              source: 'fixture_registry',
              locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000010',
              verifiable: true,
            },
            display_label: 'Negative Matrix Principal',
          },
          delegate_of: null,
          valid_from_utc: '2026-09-01T00:00:00Z',
          valid_until_utc: '2027-09-01T00:00:00Z',
          scope: {
            environments: ['isolated_fixture'],
            resource_kind: 'fixture_resource',
            resource_ids: ['f1c70000-0000-0000-0000-000000000011'],
            actions: ['read'],
          },
          revoked_at_utc: null,
        },
      ],
    };
    return resolveAgt002Phase01Authority(registry, {
      gate_type: 'LINK_VERIFICATION',
      environment: 'isolated_fixture',
      grant_id: 'GRANT-NEGATIVE-MATRIX-0001',
      delegation: null,
      principal: registry.grants[0].principal,
      resource_ids: ['f1c70000-0000-0000-0000-000000000011'],
      actions: ['read'],
      now_utc: NOW_UTC,
    }, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  },
  'gate.transition.not_allowed': () => validateAgt002Phase01GateTransition('REVOKED', 'CONSUMED'),
  'link.opportunity.discarded': () => validateAgt002Phase01ValidLink(
    {
      schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.validLinkClaim,
      claim_id: 'CLAIM-NEGATIVE-MATRIX-OPPORTUNITY-DISCARDED',
      terms: ['opportunity_open'],
      source_id: 'f1c70000-0000-0000-0000-000000000101',
      target_id: 'f1c70000-0000-0000-0000-000000000102',
      evidence: [],
    },
    {
      now_utc: NOW_UTC,
      binding_registry: BINDING_REGISTRY_DATA,
      observation: {
        rows: [
          {
            tender_id: 'f1c70000-0000-0000-0000-000000000101',
            converted_opportunity_id: 'f1c70000-0000-0000-0000-000000000102',
            internal_status: 'convertida_oportunidad',
          },
        ],
        query: { paginated: true, truncated: false, pages_fetched: 1, page_size: 50, rows_total_declared: 1 },
        authoritative: true,
        opportunity: { stage_code: 'descartado', tender_offer_status: 'en_preparacion' },
      },
    },
  ),
});

function findExpectationForCode(code) {
  return EXPECTATIONS.find((entry) => entry.expected_reasons.includes(code));
}

function coverCode(code) {
  const expectation = findExpectationForCode(code);
  if (expectation) {
    const fixturePath = path.join(FIXTURES_DIR, expectation.file);
    assert.ok(existsSync(fixturePath), `referenced fixture missing on disk: ${expectation.file}`);
    const result = evaluateAgt002Phase01Fixture(expectation, { fixtureDir: FIXTURES_DIR });
    return { verdict: result.verdict, reasons: result.reasons, source: `fixture:${expectation.file}` };
  }
  const inlineBuilder = INLINE_NEGATIVES[code];
  assert.ok(inlineBuilder, `no expectations.json row nor INLINE_NEGATIVES entry covers code "${code}"`);
  const result = inlineBuilder();
  return { verdict: result.verdict, reasons: result.reasons, source: `inline:${code}` };
}

// Group 1
test('negative matrix: REQUIRED_NEGATIVES declares exactly the 17 mandatory rows from the plan', () => {
  assert.equal(REQUIRED_NEGATIVES.length, 17);
  const totalCodes = REQUIRED_NEGATIVES.reduce((sum, negative) => sum + negative.codes.length, 0);
  assert.equal(totalCodes, 21);
  const ids = REQUIRED_NEGATIVES.map((negative) => negative.id);
  assert.equal(new Set(ids).size, ids.length, 'REQUIRED_NEGATIVES ids must be unique');
});

// Group 2
test('negative matrix: every required code is a member of the frozen AGT002_PHASE01_REASON_CODES catalog', () => {
  for (const negative of REQUIRED_NEGATIVES) {
    for (const code of negative.codes) {
      assert.ok(
        AGT002_PHASE01_REASON_CODES.includes(code),
        `${negative.id}: "${code}" is not part of AGT002_PHASE01_REASON_CODES`,
      );
    }
  }
});

// Group 3
test('negative matrix: every required code is covered by a fixture or an inline case and never resolves VALID', () => {
  for (const negative of REQUIRED_NEGATIVES) {
    for (const code of negative.codes) {
      const { verdict, reasons, source } = coverCode(code);
      assert.notEqual(verdict, 'VALID', `${negative.id} (${code}) via ${source} resolved VALID`);
      assert.ok(
        reasons.includes(code),
        `${negative.id} (${code}) via ${source}: reasons ${JSON.stringify(reasons)} do not include "${code}"`,
      );
    }
  }
});

// Group 4
test('negative matrix: every fixture file referenced by expectations.json exists on disk', () => {
  for (const entry of EXPECTATIONS) {
    const fixturePath = path.join(FIXTURES_DIR, entry.file);
    assert.ok(existsSync(fixturePath), `expectations.json references a fixture file missing on disk: ${entry.file}`);
  }
});

// Group 5
test('negative matrix: no expected_reasons entry in expectations.json is a placeholder', () => {
  for (const entry of EXPECTATIONS) {
    for (const reason of entry.expected_reasons) {
      assert.ok(
        !/placeholder/i.test(reason),
        `${entry.file}: expected_reasons contains a placeholder-like code "${reason}"`,
      );
    }
  }
});

function extractAgt002Phase01ReasonLiterals(sourceText) {
  const literals = new Set();
  const stringLiteralRegex = /'([^']+)'/g;

  const pushRegex = /reasons\.push\(([^)]*)\)/g;
  let pushMatch;
  while ((pushMatch = pushRegex.exec(sourceText)) !== null) {
    stringLiteralRegex.lastIndex = 0;
    let literalMatch;
    while ((literalMatch = stringLiteralRegex.exec(pushMatch[1])) !== null) {
      literals.add(literalMatch[1]);
    }
  }

  const arrayRegex = /reasons:\s*\[([^\]]*)\]/g;
  let arrayMatch;
  while ((arrayMatch = arrayRegex.exec(sourceText)) !== null) {
    stringLiteralRegex.lastIndex = 0;
    let literalMatch;
    while ((literalMatch = stringLiteralRegex.exec(arrayMatch[1])) !== null) {
      literals.add(literalMatch[1]);
    }
  }

  const errorsPushRegex = /errors\.push\(\{([^}]*)\}\)/g;
  const codeLiteralRegex = /code:\s*'([^']+)'/g;
  let errorsPushMatch;
  while ((errorsPushMatch = errorsPushRegex.exec(sourceText)) !== null) {
    codeLiteralRegex.lastIndex = 0;
    let codeMatch;
    while ((codeMatch = codeLiteralRegex.exec(errorsPushMatch[1])) !== null) {
      literals.add(codeMatch[1]);
    }
  }

  return literals;
}

// Group 6
test('negative matrix: every reason/reasons literal returned by agt002-phase01-executable-controls.js belongs to AGT002_PHASE01_REASON_CATALOG, including link.claim.schema_invalid', () => {
  const sourceText = readFileSync(EXECUTABLE_CONTROLS_PATH, 'utf8');
  const literals = extractAgt002Phase01ReasonLiterals(sourceText);

  assert.ok(
    literals.has('link.claim.schema_invalid'),
    'expected agt002-phase01-executable-controls.js to return "link.claim.schema_invalid" as a reason literal',
  );

  for (const literal of literals) {
    assert.ok(
      AGT002_PHASE01_REASON_CATALOG.includes(literal),
      `reason literal "${literal}" returned by agt002-phase01-executable-controls.js is not part of AGT002_PHASE01_REASON_CATALOG`,
    );
  }
});
