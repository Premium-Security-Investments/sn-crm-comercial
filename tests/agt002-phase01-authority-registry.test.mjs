import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_SCHEMA_VERSIONS,
  AGT002_PHASE01_GATE_TYPES,
  validateAgt002Phase01Schema,
  computeAgt002Phase01ArtifactSetHash,
  validateAgt002Phase01Gate,
  validateAgt002Phase01AuthorityRegistry,
  resolveAgt002Phase01Authority,
} from '../agt002-phase01-executable-controls.js';

// Loading throws (named exports validateAgt002Phase01AuthorityRegistry /
// resolveAgt002Phase01Authority not found) until Task 4 Step 3 adds them to
// agt002-phase01-executable-controls.js — this is the intended external RED
// for Step 1. Reading the schema/data paths below also throws (ENOENT) until
// Task 4 Step 3 authors contracts/agt002-phase01/v1/authority-registry.schema.json
// and contracts/agt002-phase01/v1/authority-registry.json. Neither file is
// created by this step.

const CONTRACTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contracts',
  'agt002-phase01',
  'v1',
);

const AUTHORITY_REGISTRY_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'authority-registry.schema.json');
const AUTHORITY_REGISTRY_DATA_PATH = path.join(CONTRACTS_DIR, 'authority-registry.json');
const GATE_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'gate.schema.json');

const AUTHORITY_REGISTRY_SCHEMA = JSON.parse(readFileSync(AUTHORITY_REGISTRY_SCHEMA_PATH, 'utf8'));
const AUTHORITY_REGISTRY_DATA = JSON.parse(readFileSync(AUTHORITY_REGISTRY_DATA_PATH, 'utf8'));
const GATE_SCHEMA = JSON.parse(readFileSync(GATE_SCHEMA_PATH, 'utf8'));

const NOW_UTC = '2026-09-23T18:00:00Z';

const REGISTRY_PROPERTY_KEYS = [
  'schema_version', 'registry_version', 'supersedes_registry_version', 'issued_at_utc', 'grants',
];

const GRANT_PROPERTY_KEYS = [
  'grant_id', 'gate_type', 'principal', 'delegate_of', 'valid_from_utc', 'valid_until_utc', 'scope', 'revoked_at_utc',
];

// AGT002-P1-FACT-0008: catalog of roles (role != person).
const FACT_0008_ROLES = ['admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta'];

function collectSchemaNodesMissingClosure(schema, nodePath, offenders) {
  if (schema === null || typeof schema !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(schema, 'properties')) {
    if (schema.additionalProperties !== false) {
      offenders.push(nodePath || '/');
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      collectSchemaNodesMissingClosure(child, `${nodePath}/properties/${key}`, offenders);
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'items')) {
    collectSchemaNodesMissingClosure(schema.items, `${nodePath}/items`, offenders);
  }
}

function buildGrant(overrides = {}) {
  return {
    grant_id: 'GRANT-TEST-0001',
    gate_type: 'PHASE_AUDIT',
    principal: {
      principal_id: 'f1c70000-0000-0000-0000-000000000010',
      principal_kind: 'synthetic',
      durable_ref: {
        source: 'fixture_registry',
        locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000010',
        verifiable: true,
      },
      display_label: 'Fixture Grant Principal',
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
    ...overrides,
  };
}

function buildRegistry(grants, overrides = {}) {
  return {
    schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.authorityRegistry,
    registry_version: 1,
    supersedes_registry_version: null,
    issued_at_utc: '2026-09-01T00:00:00Z',
    grants,
    ...overrides,
  };
}

function buildRequest(overrides = {}) {
  return {
    gate_type: 'PHASE_AUDIT',
    environment: 'isolated_fixture',
    grant_id: 'GRANT-TEST-0001',
    delegation: null,
    principal: buildGrant().principal,
    resource_kind: 'fixture_resource',
    resource_ids: ['f1c70000-0000-0000-0000-000000000011'],
    actions: ['read'],
    now_utc: NOW_UTC,
    ...overrides,
  };
}

// Group 1
test('authority registry schema: pinned $id/$schema/schema_version const, structural closure, registry_version and grants shape', () => {
  assert.equal(
    AUTHORITY_REGISTRY_SCHEMA.$id,
    'https://seguridadnacional.internal/contracts/agt002-phase01/v1/authority-registry.schema.json',
  );
  assert.equal(AUTHORITY_REGISTRY_SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(
    AUTHORITY_REGISTRY_SCHEMA.properties.schema_version.const,
    AGT002_PHASE01_SCHEMA_VERSIONS.authorityRegistry,
  );

  const offenders = [];
  collectSchemaNodesMissingClosure(AUTHORITY_REGISTRY_SCHEMA, '', offenders);
  assert.deepEqual(offenders, []);

  assert.equal(AUTHORITY_REGISTRY_SCHEMA.properties.registry_version.type, 'number');
  assert.equal(AUTHORITY_REGISTRY_SCHEMA.properties.grants.minItems, 1);
  assert.deepEqual(Object.keys(AUTHORITY_REGISTRY_SCHEMA.properties).sort(), [...REGISTRY_PROPERTY_KEYS].sort());
  assert.deepEqual(
    Object.keys(AUTHORITY_REGISTRY_SCHEMA.properties.grants.items.properties).sort(),
    [...GRANT_PROPERTY_KEYS].sort(),
  );
});

// Group 2
test('authority registry data: validates against its schema and covers exactly the five gate_type values', () => {
  const result = validateAgt002Phase01Schema(AUTHORITY_REGISTRY_SCHEMA, AUTHORITY_REGISTRY_DATA);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);

  assert.equal(AUTHORITY_REGISTRY_DATA.registry_version, 1);
  assert.equal(AUTHORITY_REGISTRY_DATA.supersedes_registry_version, null);

  const dataGateTypes = AUTHORITY_REGISTRY_DATA.grants.map((grant) => grant.gate_type).sort();
  assert.deepEqual(dataGateTypes, [...AGT002_PHASE01_GATE_TYPES].sort());
});

// Group 3
test('authority resolution: the full chain resolves VALID for every grant in the real registry data', () => {
  for (const grant of AUTHORITY_REGISTRY_DATA.grants) {
    const request = {
      gate_type: grant.gate_type,
      environment: 'isolated_fixture',
      grant_id: grant.grant_id,
      delegation: null,
      principal: grant.principal,
      resource_kind: grant.scope.resource_kind,
      resource_ids: [grant.scope.resource_ids[0]],
      actions: [grant.scope.actions[0]],
      now_utc: NOW_UTC,
    };
    const result = resolveAgt002Phase01Authority(AUTHORITY_REGISTRY_DATA, request, {
      registry_schema: AUTHORITY_REGISTRY_SCHEMA,
    });
    assert.equal(result.verdict, 'VALID', `${grant.grant_id}: ${JSON.stringify(result.reasons)}`);
    assert.equal(result.grant.grant_id, grant.grant_id);
  }
});

// Group 4
test('authority registry: duplicate grant_id resolves INVALID / authority.registry.duplicate_grant_id', () => {
  const registry = buildRegistry([buildGrant(), buildGrant({ gate_type: 'LINK_VERIFICATION' })]);
  const result = validateAgt002Phase01AuthorityRegistry(registry, {
    now_utc: NOW_UTC,
    registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.registry.duplicate_grant_id'));
});

// Group 5
test('authority registry: supersedes_registry_version not strictly less than registry_version resolves INVALID / authority.registry.version_not_monotonic', () => {
  const registry = buildRegistry([buildGrant()], { registry_version: 1, supersedes_registry_version: 1 });
  const result = validateAgt002Phase01AuthorityRegistry(registry, {
    now_utc: NOW_UTC,
    registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.registry.version_not_monotonic'));
});

// Group 6
test('authority resolution: nonexistent grant_id is authority.grant.not_found; absent registry is UNVERIFIED / authority.registry.absent', () => {
  const registry = buildRegistry([buildGrant()]);

  const missingGrant = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ grant_id: 'GRANT-DOES-NOT-EXIST' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(missingGrant.verdict, 'INVALID');
  assert.ok(missingGrant.reasons.includes('authority.grant.not_found'));

  const absentRegistry = resolveAgt002Phase01Authority(null, buildRequest());
  assert.equal(absentRegistry.verdict, 'UNVERIFIED');
  assert.ok(absentRegistry.reasons.includes('authority.registry.absent'));
});

// Group 7
test('authority resolution: grant.gate_type different from the requested gate_type is INVALID / authority.grant.gate_type_mismatch', () => {
  const registry = buildRegistry([buildGrant({ gate_type: 'PHASE_AUDIT' })]);
  const result = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ gate_type: 'LINK_VERIFICATION' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.grant.gate_type_mismatch'));
});

// Group 8
test('authority resolution: a principal_id equal to a AGT002-P1-FACT-0008 role is INVALID / authority.principal.role_is_not_person', () => {
  const registry = buildRegistry([buildGrant()]);
  for (const role of FACT_0008_ROLES) {
    const request = buildRequest({
      principal: { ...buildGrant().principal, principal_id: role },
    });
    const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
    assert.equal(result.verdict, 'INVALID', role);
    assert.ok(result.reasons.includes('authority.principal.role_is_not_person'), role);
  }
});

test('authority resolution: a principal without durable_ref.locator is INVALID / authority.principal.role_is_not_person', () => {
  const registry = buildRegistry([buildGrant()]);
  const principal = buildGrant().principal;
  const { locator: _omitted, ...durableRefWithoutLocator } = principal.durable_ref;
  const request = buildRequest({
    principal: { ...principal, durable_ref: durableRefWithoutLocator },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.principal.role_is_not_person'));
});

// Group 9
test('authority resolution: environment production with principal_kind synthetic is INVALID / authority.principal.synthetic_outside_isolated_fixture', () => {
  const registry = buildRegistry([buildGrant({
    scope: { ...buildGrant().scope, environments: ['isolated_fixture', 'production'] },
  })]);
  const result = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ environment: 'production' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.principal.synthetic_outside_isolated_fixture'));
});

// Group 10
test('authority resolution: environment production with a non-verifiable human principal is INVALID / authority.principal.not_verifiable_in_production', () => {
  const registry = buildRegistry([buildGrant({
    scope: { ...buildGrant().scope, environments: ['isolated_fixture', 'production'] },
  })]);
  const request = buildRequest({
    environment: 'production',
    principal: {
      principal_id: 'f1c70000-0000-0000-0000-000000000099',
      principal_kind: 'human',
      durable_ref: { source: 'psi_sales_profiles', locator: 'repo://fixture/profile/0099', verifiable: false },
      display_label: 'Fixture Human Principal',
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.principal.not_verifiable_in_production'));
});

// Group 11
test('authority resolution: out-of-validity-window now_utc is authority.grant.out_of_validity_window; revoked_at_utc not null is authority.grant.revoked', () => {
  const registry = buildRegistry([buildGrant()]);

  const beforeWindow = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ now_utc: '2026-08-01T00:00:00Z' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(beforeWindow.verdict, 'INVALID');
  assert.ok(beforeWindow.reasons.includes('authority.grant.out_of_validity_window'));

  const atOrAfterUntil = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ now_utc: '2027-09-01T00:00:00Z' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(atOrAfterUntil.verdict, 'INVALID');
  assert.ok(atOrAfterUntil.reasons.includes('authority.grant.out_of_validity_window'));

  const revokedRegistry = buildRegistry([buildGrant({ revoked_at_utc: '2026-09-10T00:00:00Z' })]);
  const revokedResult = resolveAgt002Phase01Authority(revokedRegistry, buildRequest(), {
    registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(revokedResult.verdict, 'INVALID');
  assert.ok(revokedResult.reasons.includes('authority.grant.revoked'));
});

test('authority resolution: impossible calendar timestamps never cover an instant', () => {
  const registry = buildRegistry([buildGrant({ valid_from_utc: '2026-02-30T00:00:00Z' })]);
  const result = resolveAgt002Phase01Authority(registry, buildRequest(), {
    registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.grant.out_of_validity_window'));
});

test('authority resolution: now one fractional millisecond after valid_until is out of window', () => {
  const registry = buildRegistry([buildGrant({ valid_until_utc: '2026-09-24T00:00:00Z' })]);
  const result = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ now_utc: '2026-09-24T00:00:00.001Z' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.grant.out_of_validity_window'));
});

// Group 12
test('authority resolution: delegation — vigente/correcta is VALID; vencida is authority.delegation.expired; profundidad > 1 is authority.delegation.depth_exceeded', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-BASE-0001' });
  const delegateGrant = buildGrant({ grant_id: 'GRANT-DELEGATE-0001', delegate_of: 'GRANT-BASE-0001' });
  const registry = buildRegistry([baseGrant, delegateGrant]);

  const validDelegationRequest = buildRequest({
    grant_id: 'GRANT-BASE-0001',
    delegation: {
      grant_id: 'GRANT-DELEGATE-0001',
      delegated_by: 'f1c70000-0000-0000-0000-000000000010',
      delegate_of: null,
    },
  });
  const validResult = resolveAgt002Phase01Authority(registry, validDelegationRequest, {
    registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(validResult.verdict, 'VALID', JSON.stringify(validResult.reasons));

  const expiredDelegateGrant = buildGrant({
    grant_id: 'GRANT-DELEGATE-EXPIRED',
    delegate_of: 'GRANT-BASE-0001',
    valid_until_utc: '2026-09-10T00:00:00Z',
  });
  const expiredRegistry = buildRegistry([baseGrant, expiredDelegateGrant]);
  const expiredResult = resolveAgt002Phase01Authority(
    expiredRegistry,
    buildRequest({
      grant_id: 'GRANT-BASE-0001',
      delegation: {
        grant_id: 'GRANT-DELEGATE-EXPIRED',
        delegated_by: 'f1c70000-0000-0000-0000-000000000010',
        delegate_of: null,
      },
    }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(expiredResult.verdict, 'INVALID');
  assert.ok(expiredResult.reasons.includes('authority.delegation.expired'));

  const depthGrantA = buildGrant({ grant_id: 'GRANT-DEPTH-A' });
  const depthGrantB = buildGrant({ grant_id: 'GRANT-DEPTH-B', delegate_of: 'GRANT-DEPTH-A' });
  const depthGrantC = buildGrant({ grant_id: 'GRANT-DEPTH-C', delegate_of: 'GRANT-DEPTH-B' });
  const depthRegistry = buildRegistry([depthGrantA, depthGrantB, depthGrantC]);
  const depthResult = resolveAgt002Phase01Authority(
    depthRegistry,
    buildRequest({
      grant_id: 'GRANT-DEPTH-B',
      delegation: {
        grant_id: 'GRANT-DEPTH-C',
        delegated_by: 'f1c70000-0000-0000-0000-000000000010',
        delegate_of: null,
      },
    }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(depthResult.verdict, 'INVALID');
  assert.ok(depthResult.reasons.includes('authority.delegation.depth_exceeded'));
});

test('authority resolution: delegation rejects a role used as the parent grant principal', () => {
  const rolePrincipal = {
    ...buildGrant().principal,
    principal_id: 'gerencia',
    display_label: 'Role is not a person',
  };
  const baseGrant = buildGrant({
    grant_id: 'GRANT-ROLE-PARENT-0001',
    principal: rolePrincipal,
  });
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-ROLE-DELEGATE-0001',
    delegate_of: baseGrant.grant_id,
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const result = resolveAgt002Phase01Authority(
    registry,
    buildRequest({
      grant_id: baseGrant.grant_id,
      delegation: {
        grant_id: delegateGrant.grant_id,
        delegated_by: 'gerencia',
        delegate_of: null,
      },
    }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.principal.role_is_not_person'));
});

// Group 13
test('authority resolution: scope violations include resource kind, resource id, action and environment', () => {
  const registry = buildRegistry([buildGrant()]);

  const resourceKindOut = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ resource_kind: 'other_resource_kind' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(resourceKindOut.verdict, 'INVALID');
  assert.ok(resourceKindOut.reasons.includes('authority.scope.resource_kind_out_of_scope'));

  const resourceOut = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ resource_ids: ['f1c70000-0000-0000-0000-000000009999'] }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(resourceOut.verdict, 'INVALID');
  assert.ok(resourceOut.reasons.includes('authority.scope.resource_out_of_scope'));

  const actionOut = resolveAgt002Phase01Authority(registry, buildRequest({ actions: ['delete'] }), {
    registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(actionOut.verdict, 'INVALID');
  assert.ok(actionOut.reasons.includes('authority.scope.action_out_of_scope'));

  const environmentOut = resolveAgt002Phase01Authority(
    registry,
    buildRequest({ environment: 'production' }),
    { registry_schema: AUTHORITY_REGISTRY_SCHEMA },
  );
  assert.equal(environmentOut.verdict, 'INVALID');
  assert.ok(environmentOut.reasons.includes('authority.scope.environment_out_of_scope'));
});

// Group 14
test('authority integration: validateAgt002Phase01Gate with an injected authority_registry and a nonexistent grant_id is INVALID with authority.grant.not_found in reasons', () => {
  const registry = buildRegistry([buildGrant({ grant_id: 'GRANT-TEST-0001' })]);
  const gateWithoutHash = {
    gate_id: 'GATE_AUTHORITY_INTEGRATION_0001',
    schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.gate,
    type: 'PHASE_AUDIT',
    authority: {
      principal: {
        principal_id: 'f1c70000-0000-0000-0000-000000000010',
        principal_kind: 'synthetic',
        durable_ref: {
          source: 'fixture_registry',
          locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000010',
          verifiable: true,
        },
        display_label: 'Fixture Principal',
      },
      grant_id: 'GRANT-DOES-NOT-EXIST',
      delegation: null,
    },
    objective: 'Verify that a missing grant_id fails authority resolution inside the gate',
    environment: 'isolated_fixture',
    synthetic: true,
    scope: {
      resource_kind: 'fixture_resource',
      resource_ids: ['f1c70000-0000-0000-0000-000000000011'],
      actions: ['read'],
    },
    preconditions: [
      {
        precondition_id: 'PRE-0001',
        statement: 'Fixture precondition statement',
        verdict: 'VALID',
        evidence_ids: ['EVID-0001'],
      },
    ],
    evidence: [
      {
        evidence_id: 'EVID-0001',
        kind: 'fixture_record',
        locator: 'fixture://evidence/0001',
        durable: true,
        content_hash: 'a'.repeat(64),
        captured_at_utc: '2026-09-20T00:00:00Z',
      },
    ],
    expires_at_utc: '2026-09-24T00:00:00Z',
    consumption_policy: {
      max_consumptions: 1,
      receipt_required: true,
      idempotency_key: 'idempotency-key-0001',
    },
    rollback: {
      supported: false,
      procedure: 'Compensate via fixture rollback procedure',
      locator: 'fixture://rollback/0001',
    },
    issued_at_utc: '2026-09-20T00:00:00Z',
    status: 'OPEN',
    outcome: null,
    consumption: null,
    revocation: null,
    artifact_set_hash: 'a'.repeat(64),
    active_case: null,
  };
  const gate = {
    ...gateWithoutHash,
    artifact_set_hash: computeAgt002Phase01ArtifactSetHash(gateWithoutHash),
  };

  const result = validateAgt002Phase01Gate(gate, {
    now_utc: NOW_UTC,
    gate_schema: GATE_SCHEMA,
    authority_registry: registry,
    authority_registry_schema: AUTHORITY_REGISTRY_SCHEMA,
  });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.grant.not_found'), JSON.stringify(result.reasons));
});

// Group 15
test('authority resolution: request principal different from the presented base grant principal is INVALID / authority.principal.grant_mismatch', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-BASE-0007' });
  const registry = buildRegistry([baseGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-BASE-0007',
    principal: {
      principal_id: 'f1c70000-0000-0000-0000-000000000090',
      principal_kind: 'synthetic',
      durable_ref: {
        source: 'fixture_registry',
        locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000090',
        verifiable: true,
      },
      display_label: 'Different Base Principal',
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.principal.grant_mismatch'), JSON.stringify(result.reasons));
});

test('authority resolution: delegation referencing a nonexistent delegate grant_id is INVALID / authority.delegation.grant_not_found', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-BASE-0008' });
  const registry = buildRegistry([baseGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-BASE-0008',
    delegation: {
      grant_id: 'GRANT-DELEGATE-DOES-NOT-EXIST',
      delegated_by: baseGrant.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.delegation.grant_not_found'), JSON.stringify(result.reasons));
});

test('authority resolution: delegate grant whose delegate_of points to a nonexistent parent grant is INVALID / authority.delegation.parent_grant_missing', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-BASE-0009' });
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-DELEGATE-0009',
    delegate_of: 'GRANT-PARENT-DOES-NOT-EXIST',
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-BASE-0009',
    delegation: {
      grant_id: 'GRANT-DELEGATE-0009',
      delegated_by: baseGrant.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.delegation.parent_grant_missing'), JSON.stringify(result.reasons));
});

test('authority resolution: delegate grant delegate_of different from the presented base grant_id is INVALID / authority.delegation.parent_grant_mismatch', () => {
  const baseGrantA = buildGrant({ grant_id: 'GRANT-BASE-0010A' });
  const baseGrantB = buildGrant({ grant_id: 'GRANT-BASE-0010B' });
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-DELEGATE-0010',
    delegate_of: 'GRANT-BASE-0010B',
  });
  const registry = buildRegistry([baseGrantA, baseGrantB, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-BASE-0010A',
    delegation: {
      grant_id: 'GRANT-DELEGATE-0010',
      delegated_by: baseGrantA.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.delegation.parent_grant_mismatch'), JSON.stringify(result.reasons));
});

test('authority resolution: request.delegation.delegated_by different from the base grant principal is INVALID / authority.delegation.delegated_by_mismatch', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-BASE-0011' });
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-DELEGATE-0011',
    delegate_of: 'GRANT-BASE-0011',
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-BASE-0011',
    delegation: {
      grant_id: 'GRANT-DELEGATE-0011',
      delegated_by: 'f1c70000-0000-0000-0000-000000000998',
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.delegation.delegated_by_mismatch'), JSON.stringify(result.reasons));
});

test('authority registry: validateAgt002Phase01AuthorityRegistry with no registry_schema in context is UNVERIFIED / authority.registry.schema_absent', () => {
  const registry = buildRegistry([buildGrant()]);
  const result = validateAgt002Phase01AuthorityRegistry(registry, {});
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('authority.registry.schema_absent'), JSON.stringify(result.reasons));
});

test('authority resolution: resolveAgt002Phase01Authority with a contextual third argument and no registry_schema is UNVERIFIED / authority.registry.schema_absent', () => {
  const registry = buildRegistry([buildGrant()]);
  const result = resolveAgt002Phase01Authority(registry, buildRequest(), {});
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.ok(result.reasons.includes('authority.registry.schema_absent'), JSON.stringify(result.reasons));
});

test('authority resolution: registry with a grant missing valid_until_utc resolves INVALID / schema.missing_required when registry_schema is provided', () => {
  const { valid_until_utc: _omitted, ...grantWithoutValidUntil } = buildGrant();
  const registry = buildRegistry([grantWithoutValidUntil]);
  const result = resolveAgt002Phase01Authority(registry, buildRequest(), { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('schema.missing_required'), JSON.stringify(result.reasons));
});

test('authority resolution: delegate grant narrower scope than the base grant is INVALID / authority.scope.action_out_of_scope', () => {
  const baseGrant = buildGrant({
    grant_id: 'GRANT-SCOPE-BASE-0001',
    scope: { ...buildGrant().scope, actions: ['read', 'delete'] },
  });
  const delegatePrincipal = {
    principal_id: 'f1c70000-0000-0000-0000-000000000555',
    principal_kind: 'synthetic',
    durable_ref: {
      source: 'fixture_registry',
      locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000555',
      verifiable: true,
    },
    display_label: 'Scope Delegate Principal',
  };
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-SCOPE-DELEGATE-0001',
    delegate_of: 'GRANT-SCOPE-BASE-0001',
    principal: delegatePrincipal,
    scope: { ...buildGrant().scope, actions: ['read'] },
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-SCOPE-BASE-0001',
    principal: delegatePrincipal,
    actions: ['delete'],
    delegation: {
      grant_id: 'GRANT-SCOPE-DELEGATE-0001',
      delegated_by: baseGrant.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.scope.action_out_of_scope'), JSON.stringify(result.reasons));
});

test('authority resolution: delegate grant gate_type different from the requested gate_type is INVALID / authority.delegation.gate_type_mismatch', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-GATE-MISMATCH-BASE-0001' });
  const delegatePrincipal = {
    principal_id: 'f1c70000-0000-0000-0000-000000000556',
    principal_kind: 'synthetic',
    durable_ref: {
      source: 'fixture_registry',
      locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000556',
      verifiable: true,
    },
    display_label: 'Gate Type Mismatch Delegate Principal',
  };
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-GATE-MISMATCH-DELEGATE-0001',
    delegate_of: 'GRANT-GATE-MISMATCH-BASE-0001',
    principal: delegatePrincipal,
    gate_type: 'LINK_VERIFICATION',
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-GATE-MISMATCH-BASE-0001',
    principal: delegatePrincipal,
    delegation: {
      grant_id: 'GRANT-GATE-MISMATCH-DELEGATE-0001',
      delegated_by: baseGrant.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.delegation.gate_type_mismatch'), JSON.stringify(result.reasons));
});

test('authority resolution: request missing environment, resource_ids and actions resolves INVALID with all three authority.scope.*_absent codes', () => {
  const registry = buildRegistry([buildGrant()]);
  const { environment: _environment, resource_ids: _resourceIds, actions: _actions, ...requestWithoutScope } = buildRequest();
  const result = resolveAgt002Phase01Authority(registry, requestWithoutScope, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.scope.environment_absent'), JSON.stringify(result.reasons));
  assert.ok(result.reasons.includes('authority.scope.resource_ids_absent'), JSON.stringify(result.reasons));
  assert.ok(result.reasons.includes('authority.scope.actions_absent'), JSON.stringify(result.reasons));
});

test('authority resolution: delegated request with base and delegate grant scope.actions=[read] and requested action write resolves INVALID with authority.scope.action_out_of_scope exactly once', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-DEDUP-BASE-0001' });
  const delegatePrincipal = {
    principal_id: 'f1c70000-0000-0000-0000-000000000600',
    principal_kind: 'synthetic',
    durable_ref: {
      source: 'fixture_registry',
      locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000600',
      verifiable: true,
    },
    display_label: 'Dedup Delegate Principal',
  };
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-DEDUP-DELEGATE-0001',
    delegate_of: 'GRANT-DEDUP-BASE-0001',
    principal: delegatePrincipal,
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-DEDUP-BASE-0001',
    principal: delegatePrincipal,
    actions: ['write'],
    delegation: {
      grant_id: 'GRANT-DEDUP-DELEGATE-0001',
      delegated_by: baseGrant.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  const occurrences = result.reasons.filter((reason) => reason === 'authority.scope.action_out_of_scope');
  assert.equal(occurrences.length, 1, JSON.stringify(result.reasons));
});

test('authority resolution: actor principal different from the delegate grant principal is INVALID / authority.principal.delegate_grant_mismatch', () => {
  const baseGrant = buildGrant({ grant_id: 'GRANT-BASE-0012' });
  const delegatePrincipal = {
    principal_id: 'f1c70000-0000-0000-0000-000000000777',
    principal_kind: 'synthetic',
    durable_ref: {
      source: 'fixture_registry',
      locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000777',
      verifiable: true,
    },
    display_label: 'Delegate Grant Principal',
  };
  const delegateGrant = buildGrant({
    grant_id: 'GRANT-DELEGATE-0012',
    delegate_of: 'GRANT-BASE-0012',
    principal: delegatePrincipal,
  });
  const registry = buildRegistry([baseGrant, delegateGrant]);
  const request = buildRequest({
    grant_id: 'GRANT-BASE-0012',
    principal: baseGrant.principal,
    delegation: {
      grant_id: 'GRANT-DELEGATE-0012',
      delegated_by: baseGrant.principal.principal_id,
      delegate_of: null,
    },
  });
  const result = resolveAgt002Phase01Authority(registry, request, { registry_schema: AUTHORITY_REGISTRY_SCHEMA });
  assert.equal(result.verdict, 'INVALID');
  assert.ok(result.reasons.includes('authority.principal.delegate_grant_mismatch'), JSON.stringify(result.reasons));
});
