import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
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
  'schema.array.min_items',
  'schema.max_items',
  'schema.not_unique',
  'schema.ref_unresolved',
  'schema.ref_unsupported',
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
  'gate.timestamp.invalid',
  'gate.transition.previous_status_absent',
  'gate.transition.previous_status_unverified',
  'gate.transition.previous_status_invalid',
  'gate.transition.previous_status_timestamp_invalid',
  'gate.consumption.ledger_unverified',
  'gate.consumption.ledger_invalid',
  'gate.consumption.ledger_snapshot_phase_invalid',
  'gate.consumption.ledger_snapshot_not_pre_consumption',
  'gate.consumption.actor_mismatch',
  'gate.not_actionable.status',
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
  'link.claim.schema_absent',
  'link.terms.incomplete',
  'link.binding.registry_schema_absent',
  'schema.registry_version_invalid',
  'link.decision.absent',
  'link.decision.pair_mismatch',
  'link.decision.issuer_mismatch',
  'link.decision.not_approved',
  'link.decision.revoked',
  'link.decision.window_invalid',
  'link.identity.incompatible_link',
  'link.identity.incompatible_rows_absent',
  'link.identity.process_ref_mismatch',
  'link.evidence.unresolvable',
  'link.evidence.hash_mismatch',
  'link.evidence.independent_source_required',
  'link.evidence.kind_locator_mismatch',
  'link.decision.row_mismatch',
  'authority.scope.resource_kind_absent',
  'authority.scope.resource_kind_out_of_scope',
]);

export const AGT002_PHASE01_SYNTHETIC_UUID_PREFIX = 'f1c70000-';
export const AGT002_PHASE01_FINAL_AUDIT_GATE_ID = 'FINAL_AUDIT_PHASE_0';

const KNOWN_SCHEMA_KEYWORDS = new Set([
  '$id',
  '$schema',
  '$defs',
  '$ref',
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

// $ref/$defs are authored, not instance, constraints: their well-formedness
// is checked once up front (recursively into $defs) rather than lazily as
// instance data happens to traverse into them.
function assertSchemaAuthoringValid(schema) {
  assertKnownSchemaKeywords(schema);
  if (schema.$ref !== undefined && typeof schema.$ref !== 'string') {
    throw new Error('agt002-phase01: $ref must be a string');
  }
  if (schema.$defs !== undefined) {
    if (schema.$defs === null || typeof schema.$defs !== 'object' || Array.isArray(schema.$defs)) {
      throw new Error('agt002-phase01: $defs must be an object');
    }
    for (const key of Object.keys(schema.$defs)) {
      assertSchemaAuthoringValid(schema.$defs[key]);
    }
  }
}

function decodeAgt002Phase01JsonPointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

// Resolves ONLY a local JSON Pointer fragment ("#/a/b") against the root
// schema document. No network, no external document loading. Returns
// `undefined` when the pointer does not resolve to a plain schema object.
function resolveAgt002Phase01LocalJsonPointer(rootSchema, ref) {
  const tokens = ref.slice(1).split('/').slice(1);
  let current = rootSchema;
  for (const rawToken of tokens) {
    const token = decodeAgt002Phase01JsonPointerToken(rawToken);
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (current !== null && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
      current = current[token];
    } else {
      return undefined;
    }
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
  return current;
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

function validateSchemaNode(schema, value, path, errors, rootSchema, resolvingRefs) {
  assertSchemaAuthoringValid(schema);

  if (schema.$ref !== undefined) {
    if (!schema.$ref.startsWith('#/')) {
      errors.push({ path, code: 'schema.ref_unsupported', detail: `unsupported $ref "${schema.$ref}"` });
    } else if (resolvingRefs.has(schema.$ref)) {
      errors.push({ path, code: 'schema.ref_unresolved', detail: `cyclic $ref "${schema.$ref}"` });
    } else {
      const resolved = resolveAgt002Phase01LocalJsonPointer(rootSchema, schema.$ref);
      if (resolved === undefined) {
        errors.push({ path, code: 'schema.ref_unresolved', detail: `unresolved $ref "${schema.$ref}"` });
      } else {
        const nextResolvingRefs = new Set(resolvingRefs).add(schema.$ref);
        validateSchemaNode(resolved, value, path, errors, rootSchema, nextResolvingRefs);
      }
    }
  }

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
      errors.push({ path, code: 'schema.array.min_items', detail: `length ${value.length} < ${schema.minItems}` });
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
      value.forEach((item, index) => validateSchemaNode(
        schema.items, item, `${path}/${index}`, errors, rootSchema, resolvingRefs,
      ));
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
          validateSchemaNode(
            schema.properties[key], value[key], `${path}/${key}`, errors, rootSchema, resolvingRefs,
          );
        }
      }
    }
  }
}

export function validateAgt002Phase01Schema(schema, value) {
  const errors = [];
  validateSchemaNode(schema, value, '', errors, schema, new Set());
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

function agt002Phase01IsValidRfc3339Utc(value) {
  return parseAgt002Phase01Rfc3339Utc(value) !== null;
}

function evaluateAgt002Phase01TemporalInvariantsTerm(gate, context) {
  const reasons = [];
  const status = gate && gate.status;
  const issuedAtUtc = gate && gate.issued_at_utc;
  const expiresAtUtc = gate && gate.expires_at_utc;
  const nowUtc = context.now_utc;

  const timestampsToCheck = [issuedAtUtc, expiresAtUtc, nowUtc];
  if (status === 'REVOKED' && gate.revocation) {
    timestampsToCheck.push(gate.revocation.revoked_at_utc);
  }
  if (timestampsToCheck.some((value) => !agt002Phase01IsValidRfc3339Utc(value))) {
    reasons.push('gate.timestamp.invalid');
  }

  if (status === 'DRAFT') {
    if (compareAgt002Phase01UtcInstants(issuedAtUtc, nowUtc) > 0) {
      reasons.push('gate.status.invalid_outcome_for_status');
    }
  } else if (status === 'OPEN') {
    const expiryComparison = compareAgt002Phase01UtcInstants(nowUtc, expiresAtUtc);
    if (expiryComparison === null || expiryComparison >= 0) {
      reasons.push('gate.status.open_but_expired');
    }
  } else if (status === 'EXPIRED') {
    const expiryComparison = compareAgt002Phase01UtcInstants(expiresAtUtc, nowUtc);
    if (expiryComparison === null || expiryComparison > 0) {
      reasons.push('gate.status.invalid_outcome_for_status');
    }
  } else if (status === 'REVOKED') {
    const revokedAtUtc = gate.revocation && gate.revocation.revoked_at_utc;
    if (agt002Phase01IsValidRfc3339Utc(revokedAtUtc)) {
      const afterIssue = compareAgt002Phase01UtcInstants(issuedAtUtc, revokedAtUtc);
      const beforeNow = compareAgt002Phase01UtcInstants(revokedAtUtc, nowUtc);
      if (afterIssue === null || beforeNow === null || afterIssue > 0 || beforeNow > 0) {
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

function agt002Phase01StatusIsTerminal(status) {
  const allowed = AGT002_PHASE01_ALLOWED_TRANSITIONS[status];
  return Array.isArray(allowed) && allowed.length === 0;
}

const AGT002_PHASE01_PREVIOUS_STATUS_SNAPSHOT_SCHEMA_VERSION = 'agt002-phase01-previous-status-snapshot/1.0.0';
const AGT002_PHASE01_LEDGER_SNAPSHOT_SCHEMA_VERSION = 'agt002-phase01-consumption-ledger-snapshot/1.0.0';

function resolveAgt002Phase01DurableEvidence(provenance, context) {
  const requiredStrings = ['source', 'issuer', 'locator', 'content_sha256', 'schema_version', 'captured_at_utc'];
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (requiredStrings.some((field) => typeof provenance[field] !== 'string' || provenance[field].length === 0)) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (!AGT002_PHASE01_SHA256_HEX_PATTERN.test(provenance.content_sha256)
      || !agt002Phase01IsValidRfc3339Utc(provenance.captured_at_utc)) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (!['isolated_fixture', 'independent'].includes(context.provenance_resolver_kind)) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (context.provenance_resolver_kind === 'isolated_fixture' && context.environment !== 'isolated_fixture') {
    return { verdict: 'UNVERIFIED', body: null };
  }
  // Fail-closed: a production gate never accepts durable-evidence provenance
  // sourced from a local, mutable checkout locator, even when the caller
  // labels the resolver "independent". Same canonical scheme policy as
  // production VALID_LINK evidence (agt002Phase01LocatorUsesLocalMutableScheme).
  if (context.environment === 'production' && agt002Phase01LocatorUsesLocalMutableScheme(provenance.locator)) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (typeof context.resolve_durable_evidence !== 'function') {
    return { verdict: 'UNVERIFIED', body: null };
  }

  let resolved;
  try {
    resolved = context.resolve_durable_evidence(provenance.locator, provenance);
  } catch {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (!(typeof resolved === 'string' || Buffer.isBuffer(resolved) || resolved instanceof Uint8Array)) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  const bytes = Buffer.isBuffer(resolved) ? resolved : Buffer.from(resolved);
  const digestHash = createHash('sha256');
  digestHash.write(bytes);
  digestHash.end();
  const digest = digestHash.digest('hex');
  if (digest !== provenance.content_sha256) {
    return { verdict: 'UNVERIFIED', body: null };
  }

  let body;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { verdict: 'UNVERIFIED', body: null };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || body.schema_version !== provenance.schema_version) {
    return { verdict: 'UNVERIFIED', body: null };
  }
  return { verdict: 'VALID', body };
}

function evaluateAgt002Phase01PreviousStatusDurabilityTerm(gate, context) {
  const status = gate && gate.status;
  if (!agt002Phase01StatusIsTerminal(status)) {
    return { term: 'previous_status_durability', verdict: 'VALID', reasons: [] };
  }
  const provenance = context.previous_status_provenance;
  if (provenance === undefined || provenance === null) {
    return {
      term: 'previous_status_durability', verdict: 'UNVERIFIED',
      reasons: ['gate.transition.previous_status_absent'],
    };
  }
  const resolved = resolveAgt002Phase01DurableEvidence(provenance, { ...context, environment: gate.environment });
  if (resolved.verdict !== 'VALID') {
    return {
      term: 'previous_status_durability', verdict: 'UNVERIFIED',
      reasons: ['gate.transition.previous_status_unverified'],
    };
  }
  const body = resolved.body;
  const semanticReasons = [];
  if (body.schema_version !== AGT002_PHASE01_PREVIOUS_STATUS_SNAPSHOT_SCHEMA_VERSION
      || body.gate_id !== gate.gate_id
      || !AGT002_PHASE01_GATE_STATUSES.includes(body.status)
      || !agt002Phase01IsValidRfc3339Utc(body.captured_at_utc)
      || body.captured_at_utc !== provenance.captured_at_utc) {
    semanticReasons.push('gate.transition.previous_status_invalid');
  }
  const transitionAtUtc = gate.status === 'CONSUMED'
    ? gate.consumption && gate.consumption.consumed_at_utc
    : gate.status === 'EXPIRED'
      ? gate.expires_at_utc
      : gate.revocation && gate.revocation.revoked_at_utc;
  const precedesTransition = compareAgt002Phase01UtcInstants(body.captured_at_utc, transitionAtUtc);
  if (precedesTransition === null || precedesTransition >= 0) {
    semanticReasons.push('gate.transition.previous_status_timestamp_invalid');
  }
  if (semanticReasons.length > 0) {
    return { term: 'previous_status_durability', verdict: 'INVALID', reasons: semanticReasons };
  }
  return {
    term: 'previous_status_durability', verdict: 'VALID', reasons: [],
    previous_status: body.status,
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
  const { receipt_id: receiptId, consumed_at_utc: consumedAtUtc, consumed_by: consumedBy } = consumption;
  const { issued_at_utc: issuedAtUtc, expires_at_utc: expiresAtUtc, gate_id: gateId } = gate;
  const nowUtc = context.now_utc;

  if (!agt002Phase01IsValidRfc3339Utc(consumedAtUtc)) {
    reasons.push('gate.timestamp.invalid');
  } else {
    const issuedComparison = compareAgt002Phase01UtcInstants(issuedAtUtc, consumedAtUtc);
    const nowComparison = compareAgt002Phase01UtcInstants(consumedAtUtc, nowUtc);
    const expiryComparison = compareAgt002Phase01UtcInstants(consumedAtUtc, expiresAtUtc);
    if (issuedComparison === null || nowComparison === null || expiryComparison === null
        || issuedComparison > 0 || nowComparison > 0 || expiryComparison > 0) {
      reasons.push('gate.consumption.timestamp_out_of_range');
    }
  }

  const authorizedPrincipalId = gate.authority && gate.authority.principal && gate.authority.principal.principal_id;
  if (typeof consumedBy !== 'string' || consumedBy !== authorizedPrincipalId) {
    reasons.push('gate.consumption.actor_mismatch');
  }

  const provenance = context.consumption_ledger_provenance;
  if (provenance === undefined || provenance === null) {
    const reason = context.consumption_ledger === undefined
      ? 'gate.consumption.ledger_absent'
      : 'gate.consumption.ledger_unverified';
    return {
      term: 'consumption_receipt',
      verdict: reasons.length > 0 ? 'INVALID' : 'UNVERIFIED',
      reasons: [...reasons, reason],
    };
  }
  const resolved = resolveAgt002Phase01DurableEvidence(provenance, { ...context, environment: gate.environment });
  if (resolved.verdict !== 'VALID') {
    return {
      term: 'consumption_receipt',
      verdict: reasons.length > 0 ? 'INVALID' : 'UNVERIFIED',
      reasons: [...reasons, 'gate.consumption.ledger_unverified'],
    };
  }

  const snapshot = resolved.body;
  if (snapshot.schema_version !== AGT002_PHASE01_LEDGER_SNAPSHOT_SCHEMA_VERSION
      || !Array.isArray(snapshot.entries)
      || !agt002Phase01IsValidRfc3339Utc(snapshot.as_of_utc)
      || snapshot.as_of_utc !== provenance.captured_at_utc) {
    return {
      term: 'consumption_receipt', verdict: 'INVALID',
      reasons: [...reasons, 'gate.consumption.ledger_invalid'],
    };
  }
  if (snapshot.snapshot_phase !== 'pre_consumption') {
    reasons.push('gate.consumption.ledger_snapshot_phase_invalid');
  }
  const snapshotOrder = compareAgt002Phase01UtcInstants(snapshot.as_of_utc, consumedAtUtc);
  if (snapshotOrder === null || snapshotOrder >= 0) {
    reasons.push('gate.consumption.ledger_snapshot_not_pre_consumption');
  }

  const entriesValid = snapshot.entries.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.gate_id === 'string' && entry.gate_id.length > 0
    && typeof entry.receipt_id === 'string' && entry.receipt_id.length > 0
    && agt002Phase01IsValidRfc3339Utc(entry.consumed_at_utc)
    && compareAgt002Phase01UtcInstants(entry.consumed_at_utc, snapshot.as_of_utc) <= 0);
  if (!entriesValid) {
    reasons.push('gate.consumption.ledger_invalid');
  } else {
    if (snapshot.entries.some((entry) => entry.receipt_id === receiptId)) {
      reasons.push('gate.consumption.receipt_not_unique');
    }
    if (snapshot.entries.some((entry) => entry.gate_id === gateId && entry.receipt_id !== receiptId)) {
      reasons.push('gate.consumption.exceeds_policy');
    }
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
  const fromComparison = compareAgt002Phase01UtcInstants(grant && grant.valid_from_utc, nowUtc);
  const untilComparison = compareAgt002Phase01UtcInstants(nowUtc, grant && grant.valid_until_utc);
  return fromComparison !== null && untilComparison !== null
    && fromComparison <= 0 && untilComparison < 0;
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

  if (typeof request.resource_kind !== 'string') {
    reasons.push('authority.scope.resource_kind_absent');
  } else if (request.resource_kind !== scope.resource_kind) {
    reasons.push('authority.scope.resource_kind_out_of_scope');
  }

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
      reasons.push(...evaluateAgt002Phase01PrincipalReasons(grant.principal, request.environment));

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
    resource_kind: gate && gate.scope && gate.scope.resource_kind,
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

  const previousStatusTerm = evaluateAgt002Phase01PreviousStatusDurabilityTerm(gate, context);
  if (previousStatusTerm.previous_status !== undefined) {
    terms.push(evaluateAgt002Phase01TransitionTerm(gate, {
      ...context,
      previous_status: previousStatusTerm.previous_status,
    }));
  }

  terms.push(evaluateAgt002Phase01LifecycleInvariantsTerm(gate));
  terms.push(evaluateAgt002Phase01TemporalInvariantsTerm(gate, context));
  terms.push(previousStatusTerm);
  terms.push(evaluateAgt002Phase01ConsumptionReceiptTerm(gate, context));
  terms.push(evaluateAgt002Phase01OutcomePreconditionCoherenceTerm(gate));
  terms.push(evaluateAgt002Phase01ArtifactSetHashTerm(gate));
  terms.push(evaluateAgt002Phase01AuthorityTerm(gate, context));

  const { verdict, reasons } = aggregateAgt002Phase01Verdict(terms);

  // Historical validity (was this gate ever well-governed?) is a distinct
  // question from actionability (can it be acted on right now?). Only an
  // OPEN gate is actionable; a historically VALID CONSUMED/EXPIRED/REVOKED
  // gate is still not something a caller may act upon again.
  const isOpen = gate && gate.status === 'OPEN';
  const actionability_verdict = isOpen ? verdict : 'INVALID';
  const actionability_reasons = isOpen ? reasons : ['gate.not_actionable.status'];

  return {
    verdict,
    reasons,
    checked_terms: terms,
    actionability_verdict,
    actionability_reasons,
    is_actionable: isOpen && verdict === 'VALID',
  };
}

export const AGT002_PHASE01_LINK_TERMS = Object.freeze([
  'binding_registered', 'query_exhaustive', 'authoritative_source', 'cardinality_exactly_one',
  'identity_no_conflict', 'state_live', 'opportunity_open', 'evidence_durable',
  'term_a_entity_l', 'term_b_logical', 'conversion_decision_valid', 'no_incompatible_link',
]);

// The "complete" proof for a valid link: every common term plus at least one
// of the two mutually exclusive entity-identity terms (term_a_entity_l proves
// the link via entity L, term_b_logical proves it via the logical binding).
const AGT002_PHASE01_LINK_COMPLETE_COMMON_TERMS = Object.freeze([
  'binding_registered', 'query_exhaustive', 'authoritative_source', 'cardinality_exactly_one',
  'identity_no_conflict', 'state_live', 'opportunity_open', 'evidence_durable',
  'conversion_decision_valid', 'no_incompatible_link',
]);

function agt002Phase01LinkClaimIsIncomplete(requestedTerms) {
  const missingCommon = AGT002_PHASE01_LINK_COMPLETE_COMMON_TERMS.some(
    (term) => !requestedTerms.includes(term),
  );
  const hasEntityProof = requestedTerms.includes('term_a_entity_l') || requestedTerms.includes('term_b_logical');
  return missingCommon || !hasEntityProof;
}

const AGT002_PHASE01_LITERAL_FORWARD_FK = 'psi_sales_opportunities.tender_id';
const AGT002_PHASE01_APPROVED_LINK_DIRECTION = 'inverse';
const AGT002_PHASE01_CLOSED_TENDER_OFFER_STATUSES = new Set(['cerrada_no_go', 'adjudicada', 'no_adjudicada']);
const AGT002_PHASE01_EVIDENCE_LOCATOR_SCHEMES = ['repo://', 'migration://', 'fixture://', 'evidence://'];
const AGT002_PHASE01_LOCAL_EVIDENCE_LOCATOR_SCHEMES = ['repo://', 'migration://', 'fixture://'];

// Canonical local-mutable-locator policy shared by every production gate
// (VALID_LINK evidence and durable-evidence provenance alike): a locator
// under one of these schemes is a local, mutable checkout artifact and is
// never accepted as independent evidence in production, regardless of how
// the caller labels its resolver kind.
function agt002Phase01LocatorUsesLocalMutableScheme(locator) {
  return typeof locator === 'string'
    && AGT002_PHASE01_LOCAL_EVIDENCE_LOCATOR_SCHEMES.some((scheme) => locator.startsWith(scheme));
}
const AGT002_PHASE01_EVIDENCE_KIND_SCHEME = Object.freeze({
  repo_file: 'repo://',
  migration_locator: 'migration://',
  fixture_record: 'fixture://',
  openapi_metadata: 'evidence://',
});
const AGT002_PHASE01_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const AGT002_PHASE01_DECISION_ISSUER = 'Licitaciones';
const AGT002_PHASE01_RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

function agt002Phase01IsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseAgt002Phase01Rfc3339Utc(value) {
  if (typeof value !== 'string') return null;
  const match = AGT002_PHASE01_RFC3339_UTC_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = (match[7] || '').replace(/0+$/, '');
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;

  const daysInMonth = [31, agt002Phase01IsLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return null;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const epochSecond = Math.trunc(date.getTime() / 1000);
  if (!Number.isFinite(epochSecond)) return null;
  return { epochSecond, fraction };
}

function compareAgt002Phase01UtcInstants(leftValue, rightValue) {
  const left = parseAgt002Phase01Rfc3339Utc(leftValue);
  const right = parseAgt002Phase01Rfc3339Utc(rightValue);
  if (left === null || right === null) return null;
  if (left.epochSecond < right.epochSecond) return -1;
  if (left.epochSecond > right.epochSecond) return 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(width, '0');
  const rightFraction = right.fraction.padEnd(width, '0');
  if (leftFraction < rightFraction) return -1;
  if (leftFraction > rightFraction) return 1;
  return 0;
}

// Fail-closed: without a pinned binding_registry_schema the registry is
// unverifiable, never assumed well-formed. registry_version is checked
// separately because the schema engine here has no numeric range keyword.
function validateAgt002Phase01BindingRegistryStructure(bindingRegistry, bindingRegistrySchema) {
  const { ok, errors } = validateAgt002Phase01Schema(bindingRegistrySchema, bindingRegistry);
  const reasons = ok ? [] : errors.map((error) => error.code);
  if (typeof bindingRegistry.registry_version !== 'number' || bindingRegistry.registry_version < 1) {
    reasons.push('schema.registry_version_invalid');
  }
  return { ok: reasons.length === 0, reasons };
}

function resolveAgt002Phase01BindingRegistration(termB, bindingRegistry, bindingRegistrySchema) {
  if (!bindingRegistry || !Array.isArray(bindingRegistry.bindings)) {
    return { verdict: 'UNVERIFIED', reasons: ['link.binding.not_registered'] };
  }
  if (!bindingRegistrySchema) {
    return { verdict: 'UNVERIFIED', reasons: ['link.binding.registry_schema_absent'] };
  }
  const structural = validateAgt002Phase01BindingRegistryStructure(bindingRegistry, bindingRegistrySchema);
  if (!structural.ok) {
    return { verdict: 'INVALID', reasons: structural.reasons };
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
  if (row.tender_id !== claim.source_id || row.converted_opportunity_id !== claim.target_id) {
    return { verdict: 'INVALID', reasons: ['link.identity.conflict'] };
  }
  if (row.tender_process_ref !== claim.tender_process_ref) {
    return { verdict: 'INVALID', reasons: ['link.identity.process_ref_mismatch'] };
  }
  const decision = context.observation.decision;
  if (decision && (row.conversion_decision_id !== claim.conversion_decision_id
      || row.conversion_decision_id !== decision.decision_id)) {
    return { verdict: 'INVALID', reasons: ['link.decision.row_mismatch'] };
  }
  return { verdict: 'VALID', reasons: [] };
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

function evaluateAgt002Phase01SingleEvidenceEntry(entry, context) {
  const isDurable = entry && entry.durable === true
    && typeof entry.content_hash === 'string'
    && AGT002_PHASE01_SHA256_HEX_PATTERN.test(entry.content_hash)
    && typeof entry.locator === 'string'
    && AGT002_PHASE01_EVIDENCE_LOCATOR_SCHEMES.some((scheme) => entry.locator.startsWith(scheme));
  if (!isDurable) return { verdict: 'INVALID', reasons: ['link.evidence.not_durable'] };

  const expectedScheme = AGT002_PHASE01_EVIDENCE_KIND_SCHEME[entry.kind];
  if (!expectedScheme || !entry.locator.startsWith(expectedScheme)) {
    return { verdict: 'INVALID', reasons: ['link.evidence.kind_locator_mismatch'] };
  }

  if (!context || typeof context.resolve_evidence !== 'function') {
    return { verdict: 'UNVERIFIED', reasons: ['link.evidence.unresolvable'] };
  }
  if (context.environment === 'production') {
    const usesLocalCheckout = agt002Phase01LocatorUsesLocalMutableScheme(entry.locator);
    if (usesLocalCheckout || context.evidence_resolver_kind !== 'independent') {
      return { verdict: 'UNVERIFIED', reasons: ['link.evidence.independent_source_required'] };
    }
  } else if (
    context.environment !== 'isolated_fixture'
    || !['isolated_fixture', 'independent'].includes(context.evidence_resolver_kind)
  ) {
    return { verdict: 'UNVERIFIED', reasons: ['link.evidence.unresolvable'] };
  }

  let resolved;
  try {
    resolved = context.resolve_evidence(entry.locator);
  } catch {
    return { verdict: 'UNVERIFIED', reasons: ['link.evidence.unresolvable'] };
  }
  if (resolved === null || resolved === undefined) {
    return { verdict: 'UNVERIFIED', reasons: ['link.evidence.unresolvable'] };
  }
  const evidenceHash = createHash('sha256');
  evidenceHash.write(resolved);
  evidenceHash.end();
  const actualHash = evidenceHash.digest('hex');
  if (actualHash !== entry.content_hash) {
    return { verdict: 'INVALID', reasons: ['link.evidence.hash_mismatch'] };
  }
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01EvidenceDurable(claim, context) {
  const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
  if (evidence.length === 0) return { verdict: 'UNVERIFIED', reasons: ['link.evidence.absent'] };
  const entryResults = evidence.map(
    (entry) => evaluateAgt002Phase01SingleEvidenceEntry(entry, context),
  );
  const aggregated = aggregateAgt002Phase01Verdict(
    entryResults.map((result) => ({ term: 'evidence_entry', verdict: result.verdict, reasons: result.reasons })),
  );
  return { verdict: aggregated.verdict, reasons: [...new Set(aggregated.reasons)] };
}

function evaluateAgt002Phase01TermAEntityL() {
  return { verdict: 'UNVERIFIED', reasons: ['link.term_a.entity_l_absent'] };
}

function evaluateAgt002Phase01ConversionDecisionValid(claim, context) {
  const observation = context.observation;
  if (!observation) return { verdict: 'UNVERIFIED', reasons: ['link.observation.absent'] };
  const decision = observation.decision;
  if (!decision) return { verdict: 'UNVERIFIED', reasons: ['link.decision.absent'] };

  const reasons = [];

  if (
    decision.decision_id !== claim.conversion_decision_id
    || decision.tender_id !== claim.source_id
    || decision.opportunity_id !== claim.target_id
  ) {
    reasons.push('link.decision.pair_mismatch');
  }
  if (decision.issuer !== AGT002_PHASE01_DECISION_ISSUER) reasons.push('link.decision.issuer_mismatch');
  if (decision.decision !== 'APPROVED') reasons.push('link.decision.not_approved');
  if (decision.revoked_at_utc !== null) reasons.push('link.decision.revoked');

  const fromComparison = compareAgt002Phase01UtcInstants(decision.valid_from_utc, context.now_utc);
  const untilComparison = compareAgt002Phase01UtcInstants(context.now_utc, decision.valid_until_utc);
  const withinWindow = fromComparison !== null && untilComparison !== null
    && fromComparison <= 0 && untilComparison < 0;
  if (!withinWindow) reasons.push('link.decision.window_invalid');

  if (reasons.length === 0) return { verdict: 'VALID', reasons: [] };
  return { verdict: 'INVALID', reasons };
}

function evaluateAgt002Phase01NoIncompatibleLink(context) {
  const observation = context.observation;
  if (!observation) return { verdict: 'UNVERIFIED', reasons: ['link.observation.absent'] };
  const incompatibleRows = observation.incompatible_rows;
  if (incompatibleRows === undefined) {
    return { verdict: 'UNVERIFIED', reasons: ['link.identity.incompatible_rows_absent'] };
  }
  if (Array.isArray(incompatibleRows) && incompatibleRows.length > 0) {
    return { verdict: 'INVALID', reasons: ['link.identity.incompatible_link'] };
  }
  return { verdict: 'VALID', reasons: [] };
}

function evaluateAgt002Phase01TermBLogical(claim, context) {
  const termB = claim.term_b;
  if (termB && termB.claimed_column === AGT002_PHASE01_LITERAL_FORWARD_FK) {
    return { verdict: 'UNVERIFIED', reasons: ['link.term_b.literal_fk_absent'] };
  }

  const bindingResult = resolveAgt002Phase01BindingRegistration(
    termB, context.binding_registry, context.binding_registry_schema,
  );
  if (bindingResult.verdict !== 'VALID') return bindingResult;

  const substanceResults = [
    evaluateAgt002Phase01QueryExhaustive(context),
    evaluateAgt002Phase01AuthoritativeSource(context),
    evaluateAgt002Phase01Cardinality(context),
    evaluateAgt002Phase01IdentityNoConflict(claim, context),
    evaluateAgt002Phase01StateLive(context),
    evaluateAgt002Phase01OpportunityOpen(context),
    evaluateAgt002Phase01EvidenceDurable(claim, context),
  ].map((result) => ({ term: 'term_b_logical.substance', verdict: result.verdict, reasons: result.reasons }));

  return aggregateAgt002Phase01Verdict(substanceResults);
}

const AGT002_PHASE01_LINK_TERM_EVALUATORS = Object.freeze({
  binding_registered: (claim, context) => resolveAgt002Phase01BindingRegistration(
    claim.term_b, context.binding_registry, context.binding_registry_schema,
  ),
  query_exhaustive: (claim, context) => evaluateAgt002Phase01QueryExhaustive(context),
  authoritative_source: (claim, context) => evaluateAgt002Phase01AuthoritativeSource(context),
  cardinality_exactly_one: (claim, context) => evaluateAgt002Phase01Cardinality(context),
  identity_no_conflict: (claim, context) => evaluateAgt002Phase01IdentityNoConflict(claim, context),
  state_live: (claim, context) => evaluateAgt002Phase01StateLive(context),
  opportunity_open: (claim, context) => evaluateAgt002Phase01OpportunityOpen(context),
  evidence_durable: (claim, context) => evaluateAgt002Phase01EvidenceDurable(claim, context),
  term_a_entity_l: () => evaluateAgt002Phase01TermAEntityL(),
  term_b_logical: (claim, context) => evaluateAgt002Phase01TermBLogical(claim, context),
  conversion_decision_valid: (claim, context) => evaluateAgt002Phase01ConversionDecisionValid(claim, context),
  no_incompatible_link: (claim, context) => evaluateAgt002Phase01NoIncompatibleLink(context),
});

export function validateAgt002Phase01ValidLink(claim, context) {
  // Fail-closed: without a pinned claim_schema the claim itself is
  // unverifiable, never assumed well-formed.
  if (!context || !context.claim_schema) {
    return { verdict: 'UNVERIFIED', reasons: ['link.claim.schema_absent'], terms: [] };
  }

  const requestedTerms = Array.isArray(claim && claim.terms) ? claim.terms : [];
  const terms = requestedTerms.map((term) => {
    const evaluator = AGT002_PHASE01_LINK_TERM_EVALUATORS[term];
    const result = evaluator ? evaluator(claim, context) : { verdict: 'UNVERIFIED', reasons: [] };
    return { term, verdict: result.verdict, reasons: result.reasons };
  });

  const aggregated = aggregateAgt002Phase01Verdict(terms);
  const reasons = [...aggregated.reasons];
  let verdict = aggregated.verdict;

  const { ok: claimSchemaOk, errors: claimSchemaErrors } = validateAgt002Phase01Schema(context.claim_schema, claim);
  if (!claimSchemaOk) {
    reasons.push('link.claim.schema_invalid', ...claimSchemaErrors.map((error) => error.code));
    verdict = 'INVALID';
  }

  // A claim only proves a valid link when it requests every common term plus
  // at least one entity-identity term; an incomplete request is UNVERIFIED
  // unless a present term already resolved INVALID, which dominates.
  if (requestedTerms.length > 0 && agt002Phase01LinkClaimIsIncomplete(requestedTerms)) {
    reasons.push('link.terms.incomplete');
    if (verdict !== 'INVALID') verdict = 'UNVERIFIED';
  }

  return { verdict, reasons, terms };
}

const AGT002_PHASE01_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGT002_PHASE01_CONTRACTS_DIR = path.join(AGT002_PHASE01_MODULE_DIR, 'contracts', 'agt002-phase01', 'v1');
const AGT002_PHASE01_LOCAL_EVIDENCE_SCHEMES = Object.freeze(['fixture://', 'migration://', 'repo://']);

function agt002Phase01PathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function buildAgt002Phase01LocalEvidenceResolver(rootRef) {
  let root;
  try {
    const moduleRoot = realpathSync(AGT002_PHASE01_MODULE_DIR);
    root = realpathSync(path.resolve(moduleRoot, rootRef));
    if (!agt002Phase01PathIsWithin(moduleRoot, root)) return () => null;
  } catch {
    return () => null;
  }

  return (locator) => {
    if (typeof locator !== 'string') return null;
    const scheme = AGT002_PHASE01_LOCAL_EVIDENCE_SCHEMES.find((candidate) => locator.startsWith(candidate));
    if (!scheme) return null;

    const encodedPath = locator.slice(scheme.length);
    if (!encodedPath || encodedPath.startsWith('/') || /[\\?#\0]/.test(encodedPath)) return null;

    let relativePath;
    try {
      relativePath = decodeURIComponent(encodedPath);
    } catch {
      return null;
    }
    if (!relativePath || relativePath.startsWith('/') || /[\\?#\0]/.test(relativePath)) return null;
    const segments = relativePath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;

    const lexicalTarget = path.resolve(root, ...segments);
    if (!agt002Phase01PathIsWithin(root, lexicalTarget) || lexicalTarget === root) return null;

    try {
      const realTarget = realpathSync(lexicalTarget);
      if (!agt002Phase01PathIsWithin(root, realTarget) || !statSync(realTarget).isFile()) return null;
      return readFileSync(realTarget);
    } catch {
      return null;
    }
  };
}

function readAgt002Phase01JsonFile(relativeOrAbsolutePath) {
  const absolutePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(AGT002_PHASE01_MODULE_DIR, relativeOrAbsolutePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

export function buildAgt002Phase01Context(descriptor) {
  const context = { now_utc: descriptor.now_utc };

  if (descriptor.environment !== undefined) context.environment = descriptor.environment;
  if (descriptor.evidence_resolver_kind !== undefined) {
    context.evidence_resolver_kind = descriptor.evidence_resolver_kind;
  }

  if (descriptor.previous_status_provenance !== undefined) {
    context.previous_status_provenance = descriptor.previous_status_provenance;
  }

  if (descriptor.consumption_ledger_provenance !== undefined) {
    context.consumption_ledger_provenance = descriptor.consumption_ledger_provenance;
  }

  if (descriptor.resolve_durable_evidence !== undefined) {
    context.resolve_durable_evidence = descriptor.resolve_durable_evidence;
  } else if (descriptor.provenance_root_ref !== undefined) {
    context.resolve_durable_evidence = buildAgt002Phase01LocalEvidenceResolver(descriptor.provenance_root_ref);
  }

  if (descriptor.provenance_resolver_kind !== undefined) {
    context.provenance_resolver_kind = descriptor.provenance_resolver_kind;
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

  if (descriptor.binding_registry_schema !== undefined) {
    context.binding_registry_schema = descriptor.binding_registry_schema;
  } else if (descriptor.binding_registry_schema_ref !== undefined) {
    context.binding_registry_schema = readAgt002Phase01JsonFile(descriptor.binding_registry_schema_ref);
  }

  if (descriptor.resolve_evidence !== undefined) {
    context.resolve_evidence = descriptor.resolve_evidence;
  } else if (descriptor.evidence_root_ref !== undefined) {
    context.resolve_evidence = buildAgt002Phase01LocalEvidenceResolver(descriptor.evidence_root_ref);
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
