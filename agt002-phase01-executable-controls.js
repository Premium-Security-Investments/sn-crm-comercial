import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const AGT002_PHASE01_VERDICTS = Object.freeze(['VALID', 'INVALID', 'UNVERIFIED']);

export const AGT002_PHASE01_GATE_STATUSES = Object.freeze([
  'DRAFT', 'OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED',
]);

export const AGT002_PHASE01_GATE_OUTCOMES = Object.freeze(['PASS', 'REJECTED', 'CANCELLED']);

export const AGT002_PHASE01_GATE_TYPES = Object.freeze([
  'PHASE_AUDIT', 'LINK_VERIFICATION', 'AUTHORITY_DELEGATION', 'STORAGE_DESIGN_REVIEW', 'PRODUCTION_ACTION',
]);

export const AGT002_PHASE01_ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['OPEN']),
  OPEN: Object.freeze(['CONSUMED', 'EXPIRED', 'REVOKED']),
  CONSUMED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
  REVOKED: Object.freeze([]),
});

export const AGT002_PHASE01_SCHEMA_VERSIONS = Object.freeze({
  gate: 'agt002-phase01-gate/1.0.0',
  authorityRegistry: 'agt002-phase01-authority-registry/1.0.0',
  bindingRegistry: 'agt002-phase01-binding-registry/1.0.0',
  validLinkClaim: 'agt002-phase01-valid-link-claim/1.0.0',
  fixtureContext: 'agt002-phase01-fixture-context/1.0.0',
});

export const AGT002_PHASE01_REASON_CODES = Object.freeze([
  'schema.missing_required',
  'schema.additional_property',
  'schema.type_mismatch',
  'schema.enum_mismatch',
  'schema.const_mismatch',
  'schema.pattern_mismatch',
  'schema.min_length',
  'schema.min_items',
  'schema.max_items',
  'schema.not_unique',
  'gate.transition.not_allowed',
  'gate.status.open_but_expired',
  'gate.status.invalid_outcome_for_status',
  'gate.status.consumption_not_allowed',
  'gate.status.revocation_required',
  'gate.consumption.missing',
  'gate.consumption.receipt_not_unique',
  'gate.consumption.exceeds_policy',
  'gate.consumption.ledger_absent',
  'gate.consumption.timestamp_out_of_range',
  'gate.outcome.pass_with_unmet_precondition',
  'gate.outcome.rejected_without_failed_precondition',
  'gate.outcome.cancelled_with_failed_precondition',
  'gate.artifact_set_hash.mismatch',
  'authority.registry.absent',
  'authority.registry.version_not_monotonic',
  'authority.registry.duplicate_grant_id',
  'authority.grant.not_found',
  'authority.grant.gate_type_mismatch',
  'authority.grant.out_of_validity_window',
  'authority.grant.revoked',
  'authority.delegation.expired',
  'authority.delegation.depth_exceeded',
  'authority.principal.role_is_not_person',
  'authority.principal.synthetic_outside_isolated_fixture',
  'authority.principal.not_verifiable_in_production',
  'authority.scope.resource_out_of_scope',
  'authority.scope.action_out_of_scope',
  'authority.scope.environment_out_of_scope',
  'link.term_a.entity_l_absent',
  'link.term_b.literal_fk_absent',
  'link.binding.not_registered',
  'link.binding.incompatible',
  'link.query.not_exhaustive',
  'link.observation.not_authoritative',
  'link.observation.absent',
  'link.cardinality.zero',
  'link.cardinality.multiple',
  'link.identity.conflict',
  'link.state.tender_discarded',
  'link.state.tender_not_live',
  'link.opportunity.closed',
  'link.opportunity.discarded',
  'link.evidence.absent',
  'link.evidence.not_durable',
]);

export const AGT002_PHASE01_REASON_CATALOG = Object.freeze([
  ...AGT002_PHASE01_REASON_CODES,
  'authority.registry.schema_absent',
  'link.claim.schema_invalid',
  'authority.principal.grant_mismatch',
  'authority.delegation.grant_not_found',
  'authority.delegation.parent_grant_missing',
  'authority.delegation.parent_grant_mismatch',
  'authority.delegation.delegated_by_mismatch',
  'authority.delegation.gate_type_mismatch',
  'authority.principal.delegate_grant_mismatch',
  'authority.scope.environment_absent',
  'authority.scope.resource_ids_absent',
  'authority.scope.actions_absent',
]);

export const AGT002_PHASE01_SYNTHETIC_UUID_PREFIX = 'f1c70000-';
export const AGT002_PHASE01_FINAL_AUDIT_GATE_ID = 'FINAL_AUDIT_PHASE_0';

const KNOWN_SCHEMA_KEYWORDS = new Set([
  '$id',
  '$schema',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'enum',
  'const',
  'pattern',
  'minLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
]);

function assertKnownSchemaKeywords(schema) {
  for (const key of Object.keys(schema)) {
    if (!KNOWN_SCHEMA_KEYWORDS.has(key)) {
      throw new Error(`agt002-phase01: unknown JSON Schema keyword "${key}"`);
    }
  }
}

function jsonValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function deepEqualJsonValue(a, b) {
  if (a === b) return true;
  const typeA = jsonValueType(a);
  const typeB = jsonValueType(b);
  if (typeA !== typeB) return false;
  if (typeA === 'array') {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqualJsonValue(item, b[index]));
  }
  if (typeA === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqualJsonValue(a[key], b[key]),
    );
  }
  return false;
}

function validateSchemaNode(schema, value, path, errors) {
  assertKnownSchemaKeywords(schema);

  const actualType = jsonValueType(value);

  if (schema.type !== undefined) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.includes(actualType)) {
      errors.push({
        path,
        code: 'schema.type_mismatch',
        detail: `expected type ${allowedTypes.join('|')}, got ${actualType}`,
      });
      return;
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((candidate) => deepEqualJsonValue(candidate, value))) {
    errors.push({ path, code: 'schema.enum_mismatch', detail: 'value is not one of the allowed enum values' });
  }

  if (schema.const !== undefined && !deepEqualJsonValue(schema.const, value)) {
    errors.push({ path, code: 'schema.const_mismatch', detail: 'value does not match const' });
  }

  if (actualType === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, code: 'schema.pattern_mismatch', detail: `value does not match pattern ${schema.pattern}` });
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, code: 'schema.min_length', detail: `length ${value.length} < ${schema.minLength}` });
    }
  }

  if (actualType === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, code: 'schema.min_items', detail: `length ${value.length} < ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, code: 'schema.max_items', detail: `length ${value.length} > ${schema.maxItems}` });
    }
    if (schema.uniqueItems === true) {
      const seen = [];
      const hasDuplicate = value.some((item) => {
        if (seen.some((seenItem) => deepEqualJsonValue(seenItem, item))) return true;
        seen.push(item);
        return false;
      });
      if (hasDuplicate) {
        errors.push({ path, code: 'schema.not_unique', detail: 'array items are not unique' });
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateSchemaNode(schema.items, item, `${path}/${index}`, errors));
    }
  }

  if (actualType === 'object') {
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push({ path: `${path}/${key}`, code: 'schema.missing_required', detail: `missing required property "${key}"` });
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties !== undefined) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          errors.push({ path: `${path}/${key}`, code: 'schema.additional_property', detail: `unexpected property "${key}"` });
        }
      }
    }
    if (schema.properties !== undefined) {
      for (const key of Object.keys(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateSchemaNode(schema.properties[key], value[key], `${path}/${key}`, errors);
        }
      }
    }
  }
}

export function validateAgt002Phase01Schema(schema, value) {
  const errors = [];
  validateSchemaNode(schema, value, '', errors);
  return { ok: errors.length === 0, errors };
}

function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalizeJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalizeAgt002Phase01(value) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function computeAgt002Phase01Hash(value) {
  const hash = createHash('sha256');
  hash.write(canonicalizeAgt002Phase01(value));
  hash.end();
  return hash.digest('hex');
}

export function aggregateAgt002Phase01Verdict(terms) {
  if (terms.length === 0) {
    return { verdict: 'UNVERIFIED', reasons: [] };
  }

  let hasInvalid = false;
  let hasUnverified = false;
  const reasons = [];

  for (const term of terms) {
    if (term.verdict === 'INVALID') hasInvalid = true;
    if (term.verdict === 'UNVERIFIED') hasUnverified = true;
    if (term.verdict !== 'VALID') {
      reasons.push(...term.reasons);
    }
  }

  let verdict;
  if (hasInvalid) verdict = 'INVALID';
  else if (hasUnverified) verdict = 'UNVERIFIED';
  else verdict = 'VALID';

  return { verdict, reasons };
}

const AGT002_PHASE01_ARTIFACT_SET_HASH_FIELDS = Object.freeze([
  'gate_id',
  'schema_version',
  'type',
  'authority',
  'objective',
  'environment',
  'synthetic',
  'scope',
  'preconditions',
  'evidence',
  'expires_at_utc',
  'consumption_policy',
  'rollback',
  'issued_at_utc',
]);

export function computeAgt002Phase01ArtifactSetHash(gate) {
  const subset = {};
  for (const key of AGT002_PHASE01_ARTIFACT_SET_HASH_FIELDS) {
    subset[key] = gate[key];
  }
  return computeAgt002Phase01Hash(subset);
}

export function validateAgt002Phase01GateTransition(from, to) {
  const allowed = AGT002_PHASE01_ALLOWED_TRANSITIONS[from];
  if (allowed && allowed.includes(to)) {
    return { verdict: 'VALID', reasons: [] };
  }
  return { verdict: 'INVALID', reasons: ['gate.transition.not_allowed'] };
}

function evaluateAgt002Phase01SchemaTerm(gate, context) {
  const { ok, errors } = validateAgt002Phase01Schema(context.gate_schema, gate);
  if (ok) return { term: 'schema', verdict: 'VALID', reasons: [] };
  return { term: 'schema', verdict: 'INVALID', reasons: errors.map((error) => error.code) };
}

function evaluateAgt002Phase01TransitionTerm(gate, context) {
  const result = validateAgt002Phase01GateTransition(context.previous_status, gate && gate.status);
  return { term: 'transition', verdict: result.verdict, reasons: result.reasons };
}

function evaluateAgt002Phase01LifecycleInvariantsTerm(gate) {
  const reasons = [];
  const status = gate && gate.status;
  const outcome = gate && gate.outcome;
  const consumption = gate && gate.consumption;
  const revocation = gate && gate.revocation;

  if (status === 'CONSUMED') {
    if (outcome === null || outcome === undefined) {
      reasons.push('gate.status.invalid_outcome_for_status');
    }
    if (consumption === null || consumption === undefined) {
      reasons.push('gate.consumption.missing');
    }
  } else {
    if (outcome !== null && outcome !== undefined) {
      reasons.push('gate.status.invalid_outcome_for_status');
    }
    if (consumption !== null && consumption !== undefined) {
      reasons.push('gate.status.consumption_not_allowed');
    }
  }

  if (status === 'REVOKED') {
    if (revocation === null || revocation === undefined) {
      reasons.push('gate.status.revocation_required');
    }
  } else if (revocation !== null && revocation !== undefined) {
    reasons.push('gate.status.invalid_outcome_for_status');
  }

  return {
    term: 'lifecycle_invariants',
    verdict: reasons.length === 0 ? 'VALID' : 'INVALID',
    reasons,
  };
}

function evaluateAgt002Phase01TemporalInvariantsTerm(gate, context) {
  const reasons = [];
  const status = gate && gate.status;
  const issuedAtUtc = gate && gate.issued_at_utc;
  const expiresAtUtc = gate && gate.expires_at_utc;
  const nowUtc = context.now_utc;

  if (status === 'DRAFT') {
    if (!(typeof issuedAtUtc === 'string' && issuedAtUtc <= nowUtc)) {
      reasons.push('gate.status.invalid_outcome_for_status');
    }
  } else if (status === 'OPEN') {
    if (!(typeof expiresAtUtc === 'string' && nowUtc < expiresAtUtc)) {
      reasons.push('gate.status.open_but_expired');
    }
  } else if (status === 'EXPIRED') {
    if (!(typeof expiresAtUtc === 'string' && expiresAtUtc <= nowUtc)) {
      reasons.push('gate.status.invalid_outcome_for_status');
    }
  } else if (status === 'REVOKED') {
    const revokedAtUtc = gate.revocation && gate.revocation.revoked_at_utc;
    if (typeof revokedAtUtc === 'string') {
      if (!(issuedAtUtc <= revokedAtUtc && revokedAtUtc <= nowUtc)) {
        reasons.push('gate.status.invalid_outcome_for_status');
      }
    }
  }

  return {
    term: 'temporal_invariants',
    verdict: reasons.length === 0 ? 'VALID' : 'INVALID',
    reasons,
  };
}

function evaluateAgt002Phase01ConsumptionReceiptTerm(gate, context) {
  if (!gate || gate.status !== 'CONSUMED') {
    return { term: 'consumption_receipt', verdict: 'VALID', reasons: [] };
  }

  const consumption = gate.consumption;
  if (consumption === null || consumption === undefined || typeof consumption !== 'object') {
    return { term: 'consumption_receipt', verdict: 'VALID', reasons: [] };
  }

  const reasons = [];
  const { receipt_id: receiptId, consumed_at_utc: consumedAtUtc } = consumption;
  const { issued_at_utc: issuedAtUtc, expires_at_utc: expiresAtUtc, gate_id: gateId } = gate;
  const nowUtc = context.now_utc;

  const withinIssuedAndNow = typeof consumedAtUtc === 'string'
    && issuedAtUtc <= consumedAtUtc
    && consumedAtUtc <= nowUtc;
  const withinExpiry = typeof consumedAtUtc === 'string' && consumedAtUtc <= expiresAtUtc;
  if (!withinIssuedAndNow || !withinExpiry) {
    reasons.push('gate.consumption.timestamp_out_of_range');
  }

  if (context.consumption_ledger === undefined || context.consumption_ledger === null) {
    return {
      term: 'consumption_receipt',
      verdict: reasons.length > 0 ? 'INVALID' : 'UNVERIFIED',
      reasons: [...reasons, 'gate.consumption.ledger_absent'],
    };
  }

  const ledger = context.consumption_ledger;
  if (ledger.some((entry) => entry.receipt_id === receiptId)) {
    reasons.push('gate.consumption.receipt_not_unique');
  }
  if (ledger.some((entry) => entry.gate_id === gateId && entry.receipt_id !== receiptId)) {
    reasons.push('gate.consumption.exceeds_policy');
  }

  return {
    term: 'consumption_receipt',
    verdict: reasons.length === 0 ? 'VALID' : 'INVALID',
    reasons,
  };
}

function evaluateAgt002Phase01OutcomePreconditionCoherenceTerm(gate) {
  const outcome = gate && gate.outcome;
  const preconditions = Array.isArray(gate && gate.preconditions) ? gate.preconditions : [];
  const reasons = [];

  if (outcome === 'PASS') {
    if (preconditions.some((precondition) => precondition.verdict !== 'VALID')) {
      reasons.push('gate.outcome.pass_with_unmet_precondition');
    }
  } else if (outcome === 'REJECTED') {
    if (!preconditions.some((precondition) => precondition.verdict === 'INVALID')) {
      reasons.push('gate.outcome.rejected_without_failed_precondition');
    }
  } else if (outcome === 'CANCELLED') {
    if (preconditions.some((precondition) => precondition.verdict === 'INVALID')) {
      reasons.push('gate.outcome.cancelled_with_failed_precondition');
    }
  }

  return {
    term: 'outcome_precondition_coherence',
    verdict: reasons.length === 0 ? 'VALID' : 'INVALID',
    reasons,
  };
}

function evaluateAgt002Phase01ArtifactSetHashTerm(gate) {
  const expectedHash = computeAgt002Phase01ArtifactSetHash(gate);
  if (gate && gate.artifact_set_hash === expectedHash) {
    return { term: 'artifact_set_hash', verdict: 'VALID', reasons: [] };
  }
  return { term: 'artifact_set_hash', verdict: 'INVALID', reasons: ['gate.artifact_set_hash.mismatch'] };
}

// AGT002-P1-FACT-0008: catalog of roles (role != person).
const AGT002_PHASE01_ROLE_PRINCIPAL_IDS = Object.freeze([
  'admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta',
]);

function evaluateAgt002Phase01PrincipalReasons(principal, environment) {
  const reasons = [];
  const principalId = principal && principal.principal_id;
  const hasLocator = Boolean(
    principal
    && principal.durable_ref
    && typeof principal.durable_ref.locator === 'string'
    && principal.durable_ref.locator.length > 0,
  );
  if (AGT002_PHASE01_ROLE_PRINCIPAL_IDS.includes(principalId) || !hasLocator) {
    reasons.push('authority.principal.role_is_not_person');
  }

  if (environment === 'production') {
    const principalKind = principal && principal.principal_kind;
    if (principalKind === 'synthetic') {
      reasons.push('authority.principal.synthetic_outside_isolated_fixture');
    } else if (!(principal && principal.durable_ref && principal.durable_ref.verifiable === true)) {
      reasons.push('authority.principal.not_verifiable_in_production');
    }
  }

  return reasons;
}

// Fail-closed: a grant that does not pin both ends of its validity window, or
// an instant that is not a comparable timestamp, never covers the instant.
function agt002Phase01GrantCoversInstant(grant, nowUtc) {
  if (typeof grant.valid_from_utc !== 'string' || typeof grant.valid_until_utc !== 'string') return false;
  if (typeof nowUtc !== 'string') return false;
  return grant.valid_from_utc <= nowUtc && nowUtc < grant.valid_until_utc;
}

// Fail-closed: only an explicit null means "not revoked". An absent or
// undefined revoked_at_utc is treated as revoked (the schema should have
// rejected the grant before this point).
function agt002Phase01GrantIsRevoked(grant) {
  return grant.revoked_at_utc !== null;
}

function agt002Phase01PrincipalsDurablyMatch(a, b) {
  if (!a || !b) return false;
  if (a.principal_id !== b.principal_id) return false;
  if (a.principal_kind !== b.principal_kind) return false;
  const refA = a.durable_ref;
  const refB = b.durable_ref;
  if (!refA || !refB) return false;
  if (refA.source !== refB.source) return false;
  if (refA.locator !== refB.locator) return false;
  if (refA.verifiable !== refB.verifiable) return false;
  return true;
}

function agt002Phase01ScopeReasons(grant, request) {
  const reasons = [];
  const scope = grant.scope;
  if (!scope) return reasons;

  if (Array.isArray(scope.resource_ids)) {
    if (!Array.isArray(request.resource_ids)) {
      reasons.push('authority.scope.resource_ids_absent');
    } else if (!request.resource_ids.every((id) => scope.resource_ids.includes(id))) {
      reasons.push('authority.scope.resource_out_of_scope');
    }
  }
  if (Array.isArray(scope.actions)) {
    if (!Array.isArray(request.actions)) {
      reasons.push('authority.scope.actions_absent');
    } else if (!request.actions.every((action) => scope.actions.includes(action))) {
      reasons.push('authority.scope.action_out_of_scope');
    }
  }
  if (Array.isArray(scope.environments)) {
    if (typeof request.environment !== 'string') {
      reasons.push('authority.scope.environment_absent');
    } else if (!scope.environments.includes(request.environment)) {
      reasons.push('authority.scope.environment_out_of_scope');
    }
  }

  return reasons;
}

export function validateAgt002Phase01AuthorityRegistry(registry, context = {}) {
  if (registry === null || registry === undefined) {
    return { verdict: 'UNVERIFIED', reasons: ['authority.registry.absent'] };
  }

  // Fail-closed: without a pinned schema the registry is unverifiable, never
  // assumed well-formed.
  if (!context || !context.registry_schema) {
    return { verdict: 'UNVERIFIED', reasons: ['authority.registry.schema_absent'] };
  }

  const reasons = [];

  const { ok, errors } = validateAgt002Phase01Schema(context.registry_schema, registry);
  if (!ok) reasons.push(...errors.map((error) => error.code));

  const grants = Array.isArray(registry && registry.grants) ? registry.grants : [];
  const seenGrantIds = new Set();
  let hasDuplicateGrantId = false;
  for (const grant of grants) {
    if (seenGrantIds.has(grant.grant_id)) hasDuplicateGrantId = true;
    seenGrantIds.add(grant.grant_id);
  }
  if (hasDuplicateGrantId) reasons.push('authority.registry.duplicate_grant_id');

  const supersedesVersion = registry && registry.supersedes_registry_version;
  if (supersedesVersion !== null && supersedesVersion !== undefined) {
    if (!(supersedesVersion < registry.registry_version)) {
      reasons.push('authority.registry.version_not_monotonic');
    }
  }

  return { verdict: reasons.length === 0 ? 'VALID' : 'INVALID', reasons };
}

export function resolveAgt002Phase01Authority(registry, request, context = {}) {
  if (registry === null || registry === undefined) {
    return { verdict: 'UNVERIFIED', reasons: ['authority.registry.absent'], grant: null };
  }

  // No grant is resolved out of a registry that has not itself been validated
  // against its pinned schema and structural invariants.
  const registryValidation = validateAgt002Phase01AuthorityRegistry(registry, context);
  if (registryValidation.verdict !== 'VALID') {
    return { verdict: registryValidation.verdict, reasons: [...registryValidation.reasons], grant: null };
  }

  const grants = Array.isArray(registry.grants) ? registry.grants : [];
  const grant = grants.find((candidate) => candidate.grant_id === request.grant_id);
  if (!grant) {
    return { verdict: 'INVALID', reasons: ['authority.grant.not_found'], grant: null };
  }

  const reasons = [];

  if (grant.gate_type !== request.gate_type) {
    reasons.push('authority.grant.gate_type_mismatch');
  }

  reasons.push(...evaluateAgt002Phase01PrincipalReasons(request.principal, request.environment));

  if (!agt002Phase01GrantCoversInstant(grant, request.now_utc)) {
    reasons.push('authority.grant.out_of_validity_window');
  }
  if (agt002Phase01GrantIsRevoked(grant)) {
    reasons.push('authority.grant.revoked');
  }

  const hasDelegation = request.delegation !== null && request.delegation !== undefined;

  if (!hasDelegation) {
    if (!agt002Phase01PrincipalsDurablyMatch(request.principal, grant.principal)) {
      reasons.push('authority.principal.grant_mismatch');
    }
  } else if (grant.delegate_of !== null && grant.delegate_of !== undefined) {
    reasons.push('authority.delegation.depth_exceeded');
  } else {
    const delegation = request.delegation;
    const delegateGrant = grants.find((candidate) => candidate.grant_id === delegation.grant_id);
    if (!delegateGrant) {
      reasons.push('authority.delegation.grant_not_found');
    } else {
      const parentGrant = grants.find((candidate) => candidate.grant_id === delegateGrant.delegate_of);
      if (!parentGrant) {
        reasons.push('authority.delegation.parent_grant_missing');
      } else if (parentGrant.grant_id !== grant.grant_id) {
        reasons.push('authority.delegation.parent_grant_mismatch');
      }

      if (delegation.delegated_by !== grant.principal.principal_id) {
        reasons.push('authority.delegation.delegated_by_mismatch');
      }

      if (!agt002Phase01PrincipalsDurablyMatch(request.principal, delegateGrant.principal)) {
        reasons.push('authority.principal.delegate_grant_mismatch');
      }

      if (delegateGrant.gate_type !== request.gate_type) {
        reasons.push('authority.delegation.gate_type_mismatch');
      }

      if (
        !agt002Phase01GrantCoversInstant(delegateGrant, request.now_utc)
        || agt002Phase01GrantIsRevoked(delegateGrant)
      ) {
        reasons.push('authority.delegation.expired');
      }

      // The delegate grant never widens the base grant: the request must fall
      // inside the delegate's own scope as well.
      reasons.push(...agt002Phase01ScopeReasons(delegateGrant, request));
    }
  }

  reasons.push(...agt002Phase01ScopeReasons(grant, request));

  const dedupedReasons = [...new Set(reasons)];
  return { verdict: dedupedReasons.length === 0 ? 'VALID' : 'INVALID', reasons: dedupedReasons, grant };
}

function evaluateAgt002Phase01AuthorityTerm(gate, context) {
  const registry = context.authority_registry;
  const request = {
    gate_type: gate && gate.type,
    environment: gate && gate.environment,
    grant_id: gate && gate.authority && gate.authority.grant_id,
    delegation: gate && gate.authority && gate.authority.delegation,
    principal: gate && gate.authority && gate.authority.principal,
    resource_ids: gate && gate.scope && gate.scope.resource_ids,
    actions: gate && gate.scope && gate.scope.actions,
    now_utc: context.now_utc,
  };
  const result = resolveAgt002Phase01Authority(
    registry === undefined ? null : registry,
    request,
    { registry_schema: context.authority_registry_schema },
  );
  return { term: 'authority', verdict: result.verdict, reasons: result.reasons };
}

export function validateAgt002Phase01Gate(gate, context) {
  const terms = [];

  terms.push(evaluateAgt002Phase01SchemaTerm(gate, context));

  if (context.previous_status !== undefined) {
    terms.push(evaluateAgt002Phase01TransitionTerm(gate, context));
  }

  terms.push(evaluateAgt002Phase01LifecycleInvariantsTerm(gate));
  terms.push(evaluateAgt002Phase01TemporalInvariantsTerm(gate, context));
  terms.push(evaluateAgt002Phase01ConsumptionReceiptTerm(gate, context));
  terms.push(evaluateAgt002Phase01OutcomePreconditionCoherenceTerm(gate));
  terms.push(evaluateAgt002Phase01ArtifactSetHashTerm(gate));
  terms.push(evaluateAgt002Phase01AuthorityTerm(gate, context));

  const { verdict, reasons } = aggregateAgt002Phase01Verdict(terms);
  return { verdict, reasons, checked_terms: terms };
}

export const AGT002_PHASE01_LINK_TERMS = Object.freeze([
  'binding_registered', 'query_exhaustive', 'authoritative_source', 'cardinality_exactly_one',
  'identity_no_conflict', 'state_live', 'opportunity_open', 'evidence_durable',
  'term_a_entity_l', 'term_b_logical',
]);

const AGT002_PHASE01_LITERAL_FORWARD_FK = 'psi_sales_opportunities.tender_id';
const AGT002_PHASE01_APPROVED_LINK_DIRECTION = 'inverse';
const AGT002_PHASE01_CLOSED_TENDER_OFFER_STATUSES = new Set(['cerrada_no_go', 'adjudicada', 'no_adjudicada']);
const AGT002_PHASE01_EVIDENCE_LOCATOR_SCHEMES = ['repo://', 'migration://', 'fixture://'];

function resolveAgt002Phase01BindingRegistration(termB, bindingRegistry) {
  if (!bindingRegistry || !Array.isArray(bindingRegistry.bindings)) {
    return { verdict: 'UNVERIFIED', reasons: ['link.binding.not_registered'] };
  }
  const binding = termB && bindingRegistry.bindings.find(
    (entry) => entry.binding_id === termB.binding_id
      && entry.status === 'confirmed_durable'
      && entry.logical_term === 'B',
  );
  if (!binding) {
    return { verdict: 'UNVERIFIED', reasons: ['link.binding.not_registered'] };
  }
  const compatible = termB.direction === AGT002_PHASE01_APPROVED_LINK_DIRECTION
    && termB.claimed_table === binding.table
    && termB.claimed_column === binding.column;
  if (!compatible) {
    return { verdict: 'INVALID', reasons: ['link.binding.incompatible'] };
  }
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01QueryExhaustive(context) {
  const observation = context.observation;
  if (!observation) return { verdict: 'UNVERIFIED', reasons: ['link.observation.absent'] };
  const rows = Array.isArray(observation.rows) ? observation.rows : [];
  const query = observation.query;
  const exhaustive = Boolean(
    query
    && query.paginated === true
    && query.truncated === false
    && typeof query.pages_fetched === 'number'
    && query.pages_fetched >= 1
    && query.rows_total_declared === rows.length,
  );
  if (!exhaustive) return { verdict: 'UNVERIFIED', reasons: ['link.query.not_exhaustive'] };
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01AuthoritativeSource(context) {
  const observation = context.observation;
  if (!observation) return { verdict: 'UNVERIFIED', reasons: ['link.observation.absent'] };
  if (observation.authoritative === true) return { verdict: 'VALID', reasons: [] };
  return { verdict: 'UNVERIFIED', reasons: ['link.observation.not_authoritative'] };
}

function evaluateAgt002Phase01SubstancePreconditions(context) {
  const exhaustiveCheck = evaluateAgt002Phase01QueryExhaustive(context);
  const authoritativeCheck = evaluateAgt002Phase01AuthoritativeSource(context);
  if (exhaustiveCheck.verdict !== 'VALID' || authoritativeCheck.verdict !== 'VALID') {
    return { verdict: 'UNVERIFIED', reasons: [...exhaustiveCheck.reasons, ...authoritativeCheck.reasons] };
  }
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01Cardinality(context) {
  const preconditions = evaluateAgt002Phase01SubstancePreconditions(context);
  if (preconditions.verdict !== 'VALID') return preconditions;
  const rows = context.observation.rows;
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  if (rowCount === 0) return { verdict: 'INVALID', reasons: ['link.cardinality.zero'] };
  if (rowCount > 1) return { verdict: 'INVALID', reasons: ['link.cardinality.multiple'] };
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01IdentityNoConflict(claim, context) {
  const preconditions = evaluateAgt002Phase01SubstancePreconditions(context);
  if (preconditions.verdict !== 'VALID') return preconditions;
  const rows = Array.isArray(context.observation.rows) ? context.observation.rows : [];
  if (rows.length !== 1) return { verdict: 'UNVERIFIED', reasons: [] };
  const [row] = rows;
  if (row.tender_id === claim.source_id && row.converted_opportunity_id === claim.target_id) {
    return { verdict: 'VALID', reasons: [] };
  }
  return { verdict: 'INVALID', reasons: ['link.identity.conflict'] };
}

function evaluateAgt002Phase01StateLive(context) {
  const preconditions = evaluateAgt002Phase01SubstancePreconditions(context);
  if (preconditions.verdict !== 'VALID') return preconditions;
  const rows = Array.isArray(context.observation.rows) ? context.observation.rows : [];
  if (rows.length !== 1) return { verdict: 'UNVERIFIED', reasons: [] };
  const status = rows[0].internal_status;
  if (status === 'convertida_oportunidad') return { verdict: 'VALID', reasons: [] };
  if (status === 'descartada') return { verdict: 'INVALID', reasons: ['link.state.tender_discarded'] };
  if (status === 'nueva' || status === 'en_revision') {
    return { verdict: 'INVALID', reasons: ['link.state.tender_not_live'] };
  }
  return { verdict: 'UNVERIFIED', reasons: [] };
}

function evaluateAgt002Phase01OpportunityOpen(context) {
  const preconditions = evaluateAgt002Phase01SubstancePreconditions(context);
  if (preconditions.verdict !== 'VALID') return preconditions;
  const opportunity = context.observation.opportunity;
  if (!opportunity) return { verdict: 'UNVERIFIED', reasons: [] };
  if (opportunity.stage_code === 'descartado') {
    return { verdict: 'INVALID', reasons: ['link.opportunity.discarded'] };
  }
  if (AGT002_PHASE01_CLOSED_TENDER_OFFER_STATUSES.has(opportunity.tender_offer_status)) {
    return { verdict: 'INVALID', reasons: ['link.opportunity.closed'] };
  }
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01EvidenceDurable(claim) {
  const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
  if (evidence.length === 0) return { verdict: 'UNVERIFIED', reasons: ['link.evidence.absent'] };
  const hasDurable = evidence.some(
    (entry) => entry.durable === true
      && typeof entry.content_hash === 'string' && entry.content_hash.length > 0
      && typeof entry.locator === 'string'
      && AGT002_PHASE01_EVIDENCE_LOCATOR_SCHEMES.some((scheme) => entry.locator.startsWith(scheme)),
  );
  if (hasDurable) return { verdict: 'VALID', reasons: [] };
  return { verdict: 'INVALID', reasons: ['link.evidence.not_durable'] };
}

function evaluateAgt002Phase01TermAEntityL() {
  return { verdict: 'UNVERIFIED', reasons: ['link.term_a.entity_l_absent'] };
}

function evaluateAgt002Phase01TermBLogical(claim, context) {
  const termB = claim.term_b;
  if (termB && termB.claimed_column === AGT002_PHASE01_LITERAL_FORWARD_FK) {
    return { verdict: 'UNVERIFIED', reasons: ['link.term_b.literal_fk_absent'] };
  }

  const bindingResult = resolveAgt002Phase01BindingRegistration(termB, context.binding_registry);
  if (bindingResult.verdict !== 'VALID') return bindingResult;

  const substanceResults = [
    evaluateAgt002Phase01QueryExhaustive(context),
    evaluateAgt002Phase01AuthoritativeSource(context),
    evaluateAgt002Phase01Cardinality(context),
    evaluateAgt002Phase01IdentityNoConflict(claim, context),
    evaluateAgt002Phase01StateLive(context),
    evaluateAgt002Phase01OpportunityOpen(context),
    evaluateAgt002Phase01EvidenceDurable(claim),
  ].map((result) => ({ term: 'term_b_logical.substance', verdict: result.verdict, reasons: result.reasons }));

  return aggregateAgt002Phase01Verdict(substanceResults);
}

const AGT002_PHASE01_LINK_TERM_EVALUATORS = Object.freeze({
  binding_registered: (claim, context) => resolveAgt002Phase01BindingRegistration(claim.term_b, context.binding_registry),
  query_exhaustive: (claim, context) => evaluateAgt002Phase01QueryExhaustive(context),
  authoritative_source: (claim, context) => evaluateAgt002Phase01AuthoritativeSource(context),
  cardinality_exactly_one: (claim, context) => evaluateAgt002Phase01Cardinality(context),
  identity_no_conflict: (claim, context) => evaluateAgt002Phase01IdentityNoConflict(claim, context),
  state_live: (claim, context) => evaluateAgt002Phase01StateLive(context),
  opportunity_open: (claim, context) => evaluateAgt002Phase01OpportunityOpen(context),
  evidence_durable: (claim) => evaluateAgt002Phase01EvidenceDurable(claim),
  term_a_entity_l: () => evaluateAgt002Phase01TermAEntityL(),
  term_b_logical: (claim, context) => evaluateAgt002Phase01TermBLogical(claim, context),
});

export function validateAgt002Phase01ValidLink(claim, context) {
  const requestedTerms = Array.isArray(claim && claim.terms) ? claim.terms : [];
  const terms = requestedTerms.map((term) => {
    const evaluator = AGT002_PHASE01_LINK_TERM_EVALUATORS[term];
    const result = evaluator ? evaluator(claim, context) : { verdict: 'UNVERIFIED', reasons: [] };
    return { term, verdict: result.verdict, reasons: result.reasons };
  });
  const aggregated = aggregateAgt002Phase01Verdict(terms);
  const reasons = [...aggregated.reasons];
  let verdict = aggregated.verdict;

  if (context && context.claim_schema) {
    const { ok } = validateAgt002Phase01Schema(context.claim_schema, claim);
    if (!ok) {
      reasons.push('link.claim.schema_invalid');
      verdict = 'INVALID';
    }
  }

  return { verdict, reasons, terms };
}

const AGT002_PHASE01_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGT002_PHASE01_CONTRACTS_DIR = path.join(AGT002_PHASE01_MODULE_DIR, 'contracts', 'agt002-phase01', 'v1');

function readAgt002Phase01JsonFile(relativeOrAbsolutePath) {
  const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(AGT002_PHASE01_MODULE_DIR, relativeOrAbsolutePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

export function buildAgt002Phase01Context(descriptor) {
  const context = { now_utc: descriptor.now_utc };

  if (descriptor.consumption_ledger !== undefined) {
    context.consumption_ledger = descriptor.consumption_ledger;
  }

  if (descriptor.authority_registry !== undefined) {
    context.authority_registry = descriptor.authority_registry;
  } else if (descriptor.authority_registry_ref !== undefined) {
    context.authority_registry = readAgt002Phase01JsonFile(descriptor.authority_registry_ref);
  }

  if (descriptor.authority_registry_schema_ref !== undefined) {
    context.authority_registry_schema = readAgt002Phase01JsonFile(descriptor.authority_registry_schema_ref);
  }

  if (descriptor.authority_request !== undefined) {
    context.authority_request = descriptor.authority_request;
  }

  if (descriptor.binding_registry !== undefined) {
    context.binding_registry = descriptor.binding_registry;
  } else if (descriptor.binding_registry_ref !== undefined) {
    context.binding_registry = readAgt002Phase01JsonFile(descriptor.binding_registry_ref);
  }

  if (descriptor.observation !== undefined) {
    context.observation = descriptor.observation;
  }

  return context;
}

function evaluateAgt002Phase01GateFixture(fixture, context) {
  const gateSchema = readAgt002Phase01JsonFile(path.join(AGT002_PHASE01_CONTRACTS_DIR, 'gate.schema.json'));
  const result = validateAgt002Phase01Gate(fixture, { ...context, gate_schema: gateSchema });
  return { verdict: result.verdict, reasons: result.reasons };
}

function evaluateAgt002Phase01AuthorityRegistryFixture(fixture, context) {
  // The schema is whatever the declarative context pinned, if anything: a
  // context without authority_registry_schema_ref leaves the registry
  // unverifiable (authority.registry.schema_absent), never assumed valid.
  const registrySchema = context.authority_registry_schema;
  const structural = validateAgt002Phase01AuthorityRegistry(fixture, {
    now_utc: context.now_utc,
    registry_schema: registrySchema,
  });
  const terms = [{ term: 'registry_structural', verdict: structural.verdict, reasons: structural.reasons }];

  if (context.authority_request !== undefined) {
    const resolved = resolveAgt002Phase01Authority(
      fixture,
      { ...context.authority_request, now_utc: context.now_utc },
      { registry_schema: registrySchema },
    );
    terms.push({ term: 'authority_request', verdict: resolved.verdict, reasons: resolved.reasons });
  }

  return aggregateAgt002Phase01Verdict(terms);
}

function evaluateAgt002Phase01ValidLinkFixture(fixture, context) {
  const claimSchema = readAgt002Phase01JsonFile(
    path.join(AGT002_PHASE01_CONTRACTS_DIR, 'valid-link-claim.schema.json'),
  );
  const result = validateAgt002Phase01ValidLink(fixture, { ...context, claim_schema: claimSchema });
  return { verdict: result.verdict, reasons: result.reasons };
}

const AGT002_PHASE01_FIXTURE_CONTROL_EVALUATORS = Object.freeze({
  gate: evaluateAgt002Phase01GateFixture,
  authority_registry: evaluateAgt002Phase01AuthorityRegistryFixture,
  valid_link: evaluateAgt002Phase01ValidLinkFixture,
});

export function evaluateAgt002Phase01Fixture(entry, { fixtureDir }) {
  const fixture = readAgt002Phase01JsonFile(path.join(fixtureDir, entry.file));
  const contexts = readAgt002Phase01JsonFile(path.join(fixtureDir, 'contexts.json'));
  const context = buildAgt002Phase01Context(contexts[entry.context]);

  const evaluator = AGT002_PHASE01_FIXTURE_CONTROL_EVALUATORS[entry.control];
  if (!evaluator) {
    throw new Error(`agt002-phase01: unknown fixture control "${entry.control}"`);
  }

  return evaluator(fixture, context);
}
