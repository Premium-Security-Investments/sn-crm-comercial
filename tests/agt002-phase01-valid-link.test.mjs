import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_LINK_TERMS,
  AGT002_PHASE01_SCHEMA_VERSIONS,
  validateAgt002Phase01ValidLink,
  validateAgt002Phase01Schema,
} from '../agt002-phase01-executable-controls.js';

// Loading throws (named exports AGT002_PHASE01_LINK_TERMS /
// validateAgt002Phase01ValidLink not found) until Task 6 Step 3 adds them to
// agt002-phase01-executable-controls.js — this is the intended external RED
// for Step 1. Reading VALID_LINK_CLAIM_SCHEMA_PATH below also throws (ENOENT)
// until Task 6 Step 3 authors
// contracts/agt002-phase01/v1/valid-link-claim.schema.json. Neither the
// schema nor the module changes are created by this step; the binding
// registry and binding registry schema loaded below are the real Task 5
// artifacts already on disk, and the migration hash below is computed from
// the real migration file already on disk.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1');
const VALID_LINK_CLAIM_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'valid-link-claim.schema.json');
const BINDING_REGISTRY_DATA_PATH = path.join(CONTRACTS_DIR, 'binding-registry.json');
const BINDING_REGISTRY_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'binding-registry.schema.json');

const VALID_LINK_CLAIM_SCHEMA = JSON.parse(readFileSync(VALID_LINK_CLAIM_SCHEMA_PATH, 'utf8'));
const BINDING_REGISTRY_DATA = JSON.parse(readFileSync(BINDING_REGISTRY_DATA_PATH, 'utf8'));
const BINDING_REGISTRY_SCHEMA = JSON.parse(readFileSync(BINDING_REGISTRY_SCHEMA_PATH, 'utf8'));

const MIGRATION_RELATIVE_PATH = 'supabase/migrations/005_public_tenders_radar.sql';
const MIGRATION_ABSOLUTE_PATH = path.join(REPO_ROOT, MIGRATION_RELATIVE_PATH);
const MIGRATION_CONTENT = readFileSync(MIGRATION_ABSOLUTE_PATH);
const MIGRATION_HASH = createHash('sha256');
MIGRATION_HASH.write(MIGRATION_CONTENT);
MIGRATION_HASH.end();
const MIGRATION_SHA256 = MIGRATION_HASH.digest('hex');
const KNOWN_EVIDENCE_LOCATOR = `migration://${MIGRATION_RELATIVE_PATH}`;

function resolveEvidence(locator) {
  if (locator === KNOWN_EVIDENCE_LOCATOR) {
    return MIGRATION_CONTENT;
  }
  return null;
}

const NOW_UTC = '2026-09-23T18:00:00Z';

const SOURCE_TENDER_ID = 'f1c70000-0000-0000-0000-000000000101';
const TARGET_OPPORTUNITY_ID = 'f1c70000-0000-0000-0000-000000000102';
const OTHER_OPPORTUNITY_ID = 'f1c70000-0000-0000-0000-000000009999';

const TENDER_PROCESS_REF = 'PROC-FX-0001';
const CONVERSION_DECISION_ID = 'DECISION-FX-0001';

// All eleven AGT002_PHASE01_LINK_TERMS except term_a_entity_l, which only
// appears on a claim when it actually attempts to prove term A.
const FULL_LINK_B_TERMS = Object.freeze([
  'binding_registered',
  'query_exhaustive',
  'authoritative_source',
  'cardinality_exactly_one',
  'identity_no_conflict',
  'state_live',
  'opportunity_open',
  'evidence_durable',
  'term_b_logical',
  'conversion_decision_valid',
  'no_incompatible_link',
]);

function buildApprovedTermB(overrides = {}) {
  return {
    binding_id: 'BIND-TENDER-OPPORTUNITY-INVERSE',
    direction: 'inverse',
    claimed_table: 'psi_public_tenders',
    claimed_column: 'converted_opportunity_id',
    ...overrides,
  };
}

function buildDurableEvidence(overrides = {}) {
  return [
    {
      evidence_id: 'EVID-CLAIM-0001',
      kind: 'migration_locator',
      locator: KNOWN_EVIDENCE_LOCATOR,
      durable: true,
      content_hash: MIGRATION_SHA256,
      captured_at_utc: '2026-09-23T09:00:00Z',
      ...overrides,
    },
  ];
}

function buildDecision(overrides = {}) {
  return {
    decision_id: CONVERSION_DECISION_ID,
    issuer: 'Licitaciones',
    decision: 'APPROVED',
    tender_id: SOURCE_TENDER_ID,
    opportunity_id: TARGET_OPPORTUNITY_ID,
    valid_from_utc: '2026-09-01T00:00:00Z',
    valid_until_utc: '2026-10-01T00:00:00Z',
    revoked_at_utc: null,
    ...overrides,
  };
}

function buildObservation(overrides = {}) {
  return {
    rows: [
      {
        tender_id: SOURCE_TENDER_ID,
        converted_opportunity_id: TARGET_OPPORTUNITY_ID,
        internal_status: 'convertida_oportunidad',
        tender_process_ref: TENDER_PROCESS_REF,
        conversion_decision_id: CONVERSION_DECISION_ID,
      },
    ],
    query: {
      paginated: true,
      truncated: false,
      pages_fetched: 2,
      page_size: 50,
      rows_total_declared: 1,
    },
    authoritative: true,
    opportunity: {
      stage_code: 'activo',
      tender_offer_status: 'en_preparacion',
    },
    decision: buildDecision(),
    incompatible_rows: [],
    ...overrides,
  };
}

function buildClaim(overrides = {}) {
  return {
    schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.validLinkClaim,
    claim_id: 'CLAIM-TENDER-OPPORTUNITY-0001',
    terms: FULL_LINK_B_TERMS,
    source_id: SOURCE_TENDER_ID,
    target_id: TARGET_OPPORTUNITY_ID,
    tender_process_ref: TENDER_PROCESS_REF,
    conversion_decision_id: CONVERSION_DECISION_ID,
    term_b: buildApprovedTermB(),
    evidence: buildDurableEvidence(),
    ...overrides,
  };
}

function buildContext(overrides = {}) {
  return {
    now_utc: NOW_UTC,
    environment: 'isolated_fixture',
    evidence_resolver_kind: 'isolated_fixture',
    claim_schema: VALID_LINK_CLAIM_SCHEMA,
    binding_registry: BINDING_REGISTRY_DATA,
    binding_registry_schema: BINDING_REGISTRY_SCHEMA,
    observation: buildObservation(),
    resolve_evidence: resolveEvidence,
    ...overrides,
  };
}

function findTerm(result, term) {
  return result.terms.find((entry) => entry.term === term);
}

// Group 1
test('VALID_LINK: logical term B via the approved inverse binding, exhaustive/authoritative/durable observation, resolves VALID', () => {
  assert.ok(Object.isFrozen(AGT002_PHASE01_LINK_TERMS));

  assert.deepEqual(AGT002_PHASE01_LINK_TERMS, [
    'binding_registered', 'query_exhaustive', 'authoritative_source', 'cardinality_exactly_one',
    'identity_no_conflict', 'state_live', 'opportunity_open', 'evidence_durable',
    'term_a_entity_l', 'term_b_logical', 'conversion_decision_valid', 'no_incompatible_link',
  ]);

  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext());
  assert.equal(result.verdict, 'VALID', JSON.stringify(result.reasons));
  assert.deepEqual(result.reasons, []);
});

test('VALID_LINK: mutable checkout evidence in production is UNVERIFIED even when its local hash resolves', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({
    environment: 'production',
    evidence_resolver_kind: 'isolated_fixture',
  }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.evidence.independent_source_required'), JSON.stringify(result.reasons));
  assert.notEqual(result.verdict, 'VALID');
});

// Group 2
test('VALID_LINK: term_a_entity_l requested on top of a perfect B observation still resolves UNVERIFIED / link.term_a.entity_l_absent, never VALID nor INVALID', () => {
  const claim = buildClaim({
    terms: [...FULL_LINK_B_TERMS, 'term_a_entity_l'],
    term_a: { claimed_entity: 'L' },
  });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.term_a.entity_l_absent'), JSON.stringify(result.reasons));
  assert.notEqual(result.verdict, 'VALID');
  assert.notEqual(result.verdict, 'INVALID');
});

// Group 3
test('VALID_LINK: claiming the literal FK psi_sales_opportunities.tender_id without an approved substitution resolves UNVERIFIED / link.term_b.literal_fk_absent', () => {
  const claim = buildClaim({
    terms: ['term_b_logical'],
    term_b: { claimed_column: 'psi_sales_opportunities.tender_id', direction: 'forward' },
  });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.term_b.literal_fk_absent'), JSON.stringify(result.reasons));
});

// Group 4
test('VALID_LINK: binding registry not injected resolves UNVERIFIED / link.binding.not_registered', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({ binding_registry: undefined }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.binding.not_registered'), JSON.stringify(result.reasons));
});

// Group 5
test('VALID_LINK: a claim whose direction/table/column contradicts the approved binding entry resolves INVALID / link.binding.incompatible', () => {
  const claim = buildClaim({
    terms: ['term_b_logical'],
    term_b: buildApprovedTermB({
      direction: 'forward',
      claimed_table: 'psi_sales_opportunities',
      claimed_column: 'tender_id',
    }),
  });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.binding.incompatible'), JSON.stringify(result.reasons));
});

// Group 6
test('VALID_LINK: zero rows in an exhaustive/authoritative observation resolves INVALID / link.cardinality.zero', () => {
  const claim = buildClaim({ terms: ['cardinality_exactly_one'] });
  const context = buildContext({
    observation: buildObservation({
      rows: [],
      query: { paginated: true, truncated: false, pages_fetched: 1, page_size: 50, rows_total_declared: 0 },
    }),
  });
  const result = validateAgt002Phase01ValidLink(claim, context);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.cardinality.zero'), JSON.stringify(result.reasons));
});

// Group 7
test('VALID_LINK: two rows in an exhaustive/authoritative observation resolves INVALID / link.cardinality.multiple', () => {
  const claim = buildClaim({ terms: ['cardinality_exactly_one'] });
  const context = buildContext({
    observation: buildObservation({
      rows: [
        { tender_id: SOURCE_TENDER_ID, converted_opportunity_id: TARGET_OPPORTUNITY_ID, internal_status: 'convertida_oportunidad' },
        { tender_id: SOURCE_TENDER_ID, converted_opportunity_id: OTHER_OPPORTUNITY_ID, internal_status: 'convertida_oportunidad' },
      ],
      query: { paginated: true, truncated: false, pages_fetched: 1, page_size: 50, rows_total_declared: 2 },
    }),
  });
  const result = validateAgt002Phase01ValidLink(claim, context);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.cardinality.multiple'), JSON.stringify(result.reasons));
});

// Group 8
test('VALID_LINK: rows[0].converted_opportunity_id different from claim.target_id resolves INVALID / link.identity.conflict', () => {
  const claim = buildClaim({ terms: ['identity_no_conflict'] });
  const context = buildContext({
    observation: buildObservation({
      rows: [{ tender_id: SOURCE_TENDER_ID, converted_opportunity_id: OTHER_OPPORTUNITY_ID, internal_status: 'convertida_oportunidad' }],
    }),
  });
  const result = validateAgt002Phase01ValidLink(claim, context);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.identity.conflict'), JSON.stringify(result.reasons));
});

// Group 9
test('VALID_LINK: internal_status descartada resolves link.state.tender_discarded; nueva resolves link.state.tender_not_live', () => {
  const claim = buildClaim({ terms: ['state_live'] });

  const discarded = validateAgt002Phase01ValidLink(claim, buildContext({
    observation: buildObservation({
      rows: [{ tender_id: SOURCE_TENDER_ID, converted_opportunity_id: TARGET_OPPORTUNITY_ID, internal_status: 'descartada' }],
    }),
  }));
  assert.equal(discarded.verdict, 'INVALID');
  assert.ok(discarded.reasons.includes('link.state.tender_discarded'), JSON.stringify(discarded.reasons));

  const notLive = validateAgt002Phase01ValidLink(claim, buildContext({
    observation: buildObservation({
      rows: [{ tender_id: SOURCE_TENDER_ID, converted_opportunity_id: TARGET_OPPORTUNITY_ID, internal_status: 'nueva' }],
    }),
  }));
  assert.equal(notLive.verdict, 'INVALID');
  assert.ok(notLive.reasons.includes('link.state.tender_not_live'), JSON.stringify(notLive.reasons));
});

// Group 10
test('VALID_LINK: closed opportunity offer states resolve link.opportunity.closed; discarded stage resolves link.opportunity.discarded', () => {
  const claim = buildClaim({ terms: ['opportunity_open'] });

  for (const tenderOfferStatus of ['cerrada_no_go', 'adjudicada', 'no_adjudicada']) {
    const result = validateAgt002Phase01ValidLink(claim, buildContext({
      observation: buildObservation({ opportunity: { stage_code: 'activo', tender_offer_status: tenderOfferStatus } }),
    }));
    assert.equal(result.verdict, 'INVALID', tenderOfferStatus);
    assert.ok(result.reasons.includes('link.opportunity.closed'), `${tenderOfferStatus}: ${JSON.stringify(result.reasons)}`);
  }

  const discarded = validateAgt002Phase01ValidLink(claim, buildContext({
    observation: buildObservation({ opportunity: { stage_code: 'descartado', tender_offer_status: 'en_preparacion' } }),
  }));
  assert.equal(discarded.verdict, 'INVALID');
  assert.ok(discarded.reasons.includes('link.opportunity.discarded'), JSON.stringify(discarded.reasons));
});

// Group 11a
test('VALID_LINK: empty evidence resolves INVALID / schema.array.min_items (valid-link-claim.schema.json requires minItems: 1)', () => {
  const empty = validateAgt002Phase01ValidLink(
    buildClaim({ terms: ['evidence_durable'], evidence: [] }),
    buildContext(),
  );
  assert.equal(empty.verdict, 'INVALID');
  assert.ok(empty.reasons.includes('schema.array.min_items'), JSON.stringify(empty.reasons));
});

// Group 11b
test('VALID_LINK: non-durable evidence resolves INVALID / link.evidence.not_durable', () => {
  const notDurable = validateAgt002Phase01ValidLink(
    buildClaim({ terms: ['evidence_durable'], evidence: buildDurableEvidence({ durable: false }) }),
    buildContext(),
  );
  assert.equal(notDurable.verdict, 'INVALID');
  assert.ok(notDurable.reasons.includes('link.evidence.not_durable'), JSON.stringify(notDurable.reasons));
});

// Group 12
test('VALID_LINK: truncated query, rows_total_declared mismatch, and an absent query descriptor all resolve UNVERIFIED / link.query.not_exhaustive', () => {
  const claim = buildClaim({ terms: ['query_exhaustive'] });

  const truncated = validateAgt002Phase01ValidLink(claim, buildContext({
    observation: buildObservation({ query: { paginated: true, truncated: true, pages_fetched: 1, page_size: 50, rows_total_declared: 1 } }),
  }));
  assert.equal(truncated.verdict, 'UNVERIFIED');
  assert.ok(truncated.reasons.includes('link.query.not_exhaustive'), JSON.stringify(truncated.reasons));

  const mismatchedTotal = validateAgt002Phase01ValidLink(claim, buildContext({
    observation: buildObservation({ query: { paginated: true, truncated: false, pages_fetched: 1, page_size: 50, rows_total_declared: 3 } }),
  }));
  assert.equal(mismatchedTotal.verdict, 'UNVERIFIED');
  assert.ok(mismatchedTotal.reasons.includes('link.query.not_exhaustive'), JSON.stringify(mismatchedTotal.reasons));

  const missingQuery = validateAgt002Phase01ValidLink(claim, buildContext({
    observation: buildObservation({ query: undefined }),
  }));
  assert.equal(missingQuery.verdict, 'UNVERIFIED');
  assert.ok(missingQuery.reasons.includes('link.query.not_exhaustive'), JSON.stringify(missingQuery.reasons));
});

// Group 13
test('VALID_LINK: authoritative false resolves link.observation.not_authoritative; observation absent resolves link.observation.absent with every substance term UNVERIFIED', () => {
  const notAuthoritative = validateAgt002Phase01ValidLink(
    buildClaim({ terms: ['authoritative_source'] }),
    buildContext({ observation: buildObservation({ authoritative: false }) }),
  );
  assert.equal(notAuthoritative.verdict, 'UNVERIFIED');
  assert.ok(notAuthoritative.reasons.includes('link.observation.not_authoritative'), JSON.stringify(notAuthoritative.reasons));

  const claim = buildClaim({ terms: FULL_LINK_B_TERMS });
  const absentObservation = validateAgt002Phase01ValidLink(claim, buildContext({ observation: undefined }));
  assert.equal(absentObservation.verdict, 'UNVERIFIED');
  assert.ok(absentObservation.reasons.includes('link.observation.absent'), JSON.stringify(absentObservation.reasons));
  assert.notEqual(absentObservation.verdict, 'VALID');

  const observationDependentTerms = [
    'query_exhaustive', 'authoritative_source', 'cardinality_exactly_one',
    'identity_no_conflict', 'state_live', 'opportunity_open',
  ];
  for (const term of observationDependentTerms) {
    const entry = findTerm(absentObservation, term);
    assert.ok(entry, `missing checked term ${term}`);
    assert.equal(entry.verdict, 'UNVERIFIED', term);
  }
});

// Group 14
test('VALID_LINK: precedence — an INVALID substance term alongside an UNVERIFIED term_a_entity_l aggregates to INVALID and preserves both verdicts per term', () => {
  const claim = buildClaim({
    terms: ['cardinality_exactly_one', 'term_a_entity_l'],
    term_a: { claimed_entity: 'L' },
  });
  const context = buildContext({
    observation: buildObservation({
      rows: [],
      query: { paginated: true, truncated: false, pages_fetched: 1, page_size: 50, rows_total_declared: 0 },
    }),
  });
  const result = validateAgt002Phase01ValidLink(claim, context);
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.cardinality.zero'), JSON.stringify(result.reasons));
  assert.ok(result.reasons.includes('link.term_a.entity_l_absent'), JSON.stringify(result.reasons));

  const cardinalityTerm = findTerm(result, 'cardinality_exactly_one');
  assert.equal(cardinalityTerm.verdict, 'INVALID');
  const termA = findTerm(result, 'term_a_entity_l');
  assert.equal(termA.verdict, 'UNVERIFIED');
});

// Group 15
test('VALID_LINK: an empty claim.terms resolves UNVERIFIED (fail-closed)', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim({ terms: [] }), buildContext());
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.terms, []);
});

// Group 16
test('VALID_LINK: an incomplete proof (terms=[evidence_durable]) with fully verifiable evidence still resolves UNVERIFIED / link.terms.incomplete, never VALID', () => {
  const claim = buildClaim({ terms: ['evidence_durable'] });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.notEqual(result.verdict, 'VALID');
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.terms.incomplete'), JSON.stringify(result.reasons));
});

// Group 17
test('VALID_LINK: context without claim_schema resolves UNVERIFIED / link.claim.schema_absent', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({ claim_schema: undefined }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.claim.schema_absent'), JSON.stringify(result.reasons));
});

// Group 18
test('VALID_LINK: context without binding_registry_schema resolves UNVERIFIED / link.binding.registry_schema_absent', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({ binding_registry_schema: undefined }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.binding.registry_schema_absent'), JSON.stringify(result.reasons));
});

// Group 19
test('VALID_LINK: a binding registry with registry_version 0 fails registry schema validation and resolves INVALID with a schema.* reason', () => {
  const invalidRegistry = { ...BINDING_REGISTRY_DATA, registry_version: 0 };
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({ binding_registry: invalidRegistry }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.some((reason) => reason.startsWith('schema.')), JSON.stringify(result.reasons));
});

// Group 20
test('VALID_LINK: an observation without a decision resolves UNVERIFIED / link.decision.absent', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({
    observation: buildObservation({ decision: undefined }),
  }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.decision.absent'), JSON.stringify(result.reasons));
});

// Group 21
test('VALID_LINK: a decision whose opportunity_id differs from claim.target_id resolves INVALID / link.decision.pair_mismatch', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({
    observation: buildObservation({ decision: buildDecision({ opportunity_id: OTHER_OPPORTUNITY_ID }) }),
  }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.decision.pair_mismatch'), JSON.stringify(result.reasons));
});

// Group 22
test('VALID_LINK: a non-empty incompatible_rows resolves INVALID / link.identity.incompatible_link', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({
    observation: buildObservation({
      incompatible_rows: [{ tender_id: SOURCE_TENDER_ID, converted_opportunity_id: OTHER_OPPORTUNITY_ID }],
    }),
  }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.identity.incompatible_link'), JSON.stringify(result.reasons));
});

// Group 23
test('VALID_LINK: an evidence locator resolve_evidence cannot resolve resolves UNVERIFIED / link.evidence.unresolvable', () => {
  const claim = buildClaim({
    terms: ['evidence_durable'],
    evidence: buildDurableEvidence({ locator: 'migration://supabase/migrations/999_does_not_exist.sql' }),
  });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('link.evidence.unresolvable'), JSON.stringify(result.reasons));
});

// Group 24
test('VALID_LINK: a resolvable locator whose content_hash is a wrong all-zero hash resolves INVALID / link.evidence.hash_mismatch', () => {
  const claim = buildClaim({
    terms: ['evidence_durable'],
    evidence: buildDurableEvidence({ content_hash: '0'.repeat(64) }),
  });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.evidence.hash_mismatch'), JSON.stringify(result.reasons));
});

// Group 25
test('VALID_LINK: a row.tender_process_ref different from claim.tender_process_ref resolves INVALID / link.identity.process_ref_mismatch', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({
    observation: buildObservation({
      rows: [{
        tender_id: SOURCE_TENDER_ID,
        converted_opportunity_id: TARGET_OPPORTUNITY_ID,
        internal_status: 'convertida_oportunidad',
        tender_process_ref: 'PROC-OTHER-9999',
        conversion_decision_id: CONVERSION_DECISION_ID,
      }],
    }),
  }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.identity.process_ref_mismatch'), JSON.stringify(result.reasons));
});

// Group 26
test('VALID_LINK: a row.conversion_decision_id different from the canonical decision_id resolves INVALID / link.decision.row_mismatch', () => {
  const result = validateAgt002Phase01ValidLink(buildClaim(), buildContext({
    observation: buildObservation({
      rows: [{
        tender_id: SOURCE_TENDER_ID,
        converted_opportunity_id: TARGET_OPPORTUNITY_ID,
        internal_status: 'convertida_oportunidad',
        tender_process_ref: TENDER_PROCESS_REF,
        conversion_decision_id: 'DECISION-FRAUDULENTA',
      }],
      decision: buildDecision(),
    }),
  }));
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.decision.row_mismatch'), JSON.stringify(result.reasons));
});

// Group 27
test('VALID_LINK: a second resolvable evidence item with a wrong all-zero content_hash cannot be hidden behind a first valid item — resolves INVALID / link.evidence.hash_mismatch', () => {
  const claim = buildClaim({
    terms: ['evidence_durable'],
    evidence: [
      ...buildDurableEvidence(),
      ...buildDurableEvidence({ evidence_id: 'EVID-CLAIM-0002', content_hash: '0'.repeat(64) }),
    ],
  });
  const result = validateAgt002Phase01ValidLink(claim, buildContext());
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('link.evidence.hash_mismatch'), JSON.stringify(result.reasons));
});

// Group 28
test('VALID_LINK claim schema: evidence: [] is rejected with schema.array.min_items', () => {
  const claim = buildClaim({ evidence: [] });
  const { ok, errors } = validateAgt002Phase01Schema(VALID_LINK_CLAIM_SCHEMA, claim);
  assert.equal(ok, false, JSON.stringify(errors));
  assert.ok(errors.some((error) => error.code === 'schema.array.min_items'), JSON.stringify(errors));
});
