import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prioritizeVigiaOpportunities } from '../vigia-engine.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsRoot = path.join(repoRoot, 'contracts', 'agents');
const version = '1.0.0';
const draft = 'https://json-schema.org/draft/2020-12/schema';
const allowedCapabilities = new Set([
  'agt003.priorities.read',
  'agt002.radar.read',
  'agt002.dossier.read',
  'agt002.analysis.read',
  'agt002.go_no_go.recommendation.read',
]);
const expected = {
  'AGT-003': ['agt003.priorities.read'],
  'AGT-002': [
    'agt002.radar.read',
    'agt002.dossier.read',
    'agt002.analysis.read',
    'agt002.go_no_go.recommendation.read',
  ],
};
const expectedDatasets = {
  'agt003.priorities.read': 'v_psi_sales_opportunity_enriched',
  'agt002.radar.read': 'psi_public_tenders',
  'agt002.dossier.read': 'psi_sales_interactions',
  'agt002.analysis.read': 'psi_sales_interactions:tender_document_analysis',
  'agt002.go_no_go.recommendation.read': 'psi_sales_interactions:tender_document_analysis',
};
const authorityFields = new Set([
  'role', 'roles', 'area', 'areas', 'owner', 'owners', 'owner_scope',
  'scope', 'scopes', 'membership', 'memberships', 'source', 'sources',
  'authorized_sources', 'delegation', 'permissions',
]);
const forbiddenCapabilityFragments = [
  '.write', '.create', '.update', '.delete', '.sync', '.import', '.execute',
  '.convert', '.discard', '.approve', '.prepare', '.send', '.sign', '.submit',
];
const prohibitedOperationFieldFragments = [
  'sync', 'import', 'conversion', 'discard', 'approval', 'preparation',
  'send', 'signature', 'submission',
];
const sensitiveResponseFields = new Set([
  'documents', 'signed_url', 'storage_path', 'extracted_text', 'raw', 'content_base64',
  'approved_by', 'created_by', 'technical_authorized', 'permissions', 'profile_source', 'checklist',
]);

function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validate(schema, value, location = '$') {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => typeMatches(value, type))) {
    return [`${location}: expected ${types.join('|')}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${location}: must equal const`);
  if (schema.enum && !schema.enum.some(candidate => candidate === value)) errors.push(`${location}: outside enum`);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(candidate => validate(candidate, value, location).length === 0).length;
    if (matches !== 1) errors.push(`${location}: expected exactly one oneOf branch, got ${matches}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location}: shorter than minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${location}: longer than maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location}: pattern mismatch`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${location}: invalid date-time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${location}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${location}: above maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${location}: not above exclusiveMinimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${location}: not below exclusiveMaximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location}: fewer than minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location}: more than maxItems`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${location}: items are not unique`);
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${location}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${location}: missing ${required}`);
    }
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) errors.push(...validate(properties[key], item, `${location}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${location}: unexpected ${key}`);
    }
  }
  return errors;
}

function assertClosedObjects(schema, location) {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${location}: object schemas must reject extra fields`);
    for (const [name, child] of Object.entries(schema.properties || {})) assertClosedObjects(child, `${location}.properties.${name}`);
  }
  if (schema.items) assertClosedObjects(schema.items, `${location}.items`);
  for (const [index, branch] of (schema.oneOf || []).entries()) assertClosedObjects(branch, `${location}.oneOf[${index}]`);
}

function collectPropertyNames(schema, names = []) {
  for (const [name, child] of Object.entries(schema.properties || {})) {
    names.push(name);
    collectPropertyNames(child, names);
  }
  if (schema.items) collectPropertyNames(schema.items, names);
  for (const branch of schema.oneOf || []) collectPropertyNames(branch, names);
  return names;
}

function assertSyntheticFixture(value, location = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSyntheticFixture(item, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      assert.doesNotMatch(item, /\/root\//, `${location}.${key}: local paths are forbidden`);
      assert.doesNotMatch(item, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, `${location}.${key}: emails are forbidden`);
      assert.doesNotMatch(item, /\b(?:nit|tel[eé]fono|celular|documento|proceso real)\b/i, `${location}.${key}: real-world personal/process markers are forbidden`);
      assert.doesNotMatch(item, /\b(?:\+?57)?3\d{9}\b/, `${location}.${key}: phone-like values are forbidden`);
      if (/(?:^|_)(?:id|key)$/.test(key) && !['capability_id'].includes(key) && item !== 'CRM-F1') {
        assert.match(item, /^syn-[a-z0-9-]+$/, `${location}.${key}: identifiers must use the syn- namespace`);
      }
    }
    assertSyntheticFixture(item, `${location}.${key}`);
  }
}

assert.ok(existsSync(contractsRoot), 'P1A contracts root must exist');

const allManifestCapabilities = [];
for (const [agentId, capabilityIds] of Object.entries(expected)) {
  const versionDir = path.join(contractsRoot, agentId, 'v1');
  const manifestPath = path.join(versionDir, 'manifest.json');
  assert.ok(existsSync(manifestPath), `${agentId}: manifest must exist`);
  const manifest = loadJson(manifestPath);

  assert.equal(manifest.agent_id, agentId);
  assert.equal(manifest.contract_version, version);
  assert.equal(manifest.schema_draft, draft);
  assert.equal(manifest.owner_system, 'SIIO');
  assert.equal(manifest.status, 'contract_only');
  assert.equal(manifest.immutable, true);
  assert.deepEqual(manifest.capabilities.map(item => item.id), capabilityIds);
  assert.ok(Array.isArray(manifest.fixtures) && manifest.fixtures.length >= capabilityIds.length * 4 + 2, `${agentId}: valid/invalid request+response fixtures and error fixtures are required`);

  for (const capability of manifest.capabilities) {
    allManifestCapabilities.push(capability.id);
    assert.ok(allowedCapabilities.has(capability.id), `${capability.id}: capability is not allowlisted`);
    assert.equal(capability.mode, 'read');
    assert.equal(capability.persisted_results_only, agentId === 'AGT-002', `${capability.id}: only AGT-002 is restricted to persisted results`);
    for (const fragment of forbiddenCapabilityFragments) assert.ok(!capability.id.includes(fragment), `${capability.id}: forbidden mutating capability fragment`);
    for (const field of ['request_schema', 'response_schema', 'error_schema']) {
      const relative = capability[field];
      assert.equal(path.dirname(relative), '.', `${agentId}.${capability.id}.${field}: schema path must remain inside v1`);
      const schemaPath = path.join(versionDir, relative);
      assert.ok(existsSync(schemaPath), `${schemaPath}: declared schema must exist`);
      const schema = loadJson(schemaPath);
      assert.equal(schema.$schema, draft, `${relative}: Draft 2020-12 required`);
      assert.match(schema.$id, /^urn:psi:siio:agents:agt00[23]:v1:/, `${relative}: stable URN required`);
      assert.equal(schema.type, 'object', `${relative}: root must be object`);
      assertClosedObjects(schema, relative);
    }

    const requestSchema = loadJson(path.join(versionDir, capability.request_schema));
    assert.equal(requestSchema.properties.contract_version.const, version);
    assert.equal(requestSchema.properties.capability_id.const, capability.id);
    assert.ok(requestSchema.required.includes('correlation_id'));
    for (const field of collectPropertyNames(requestSchema)) {
      assert.ok(!authorityFields.has(field), `${capability.id}: request body must not accept authority field ${field}`);
    }

    const responseSchema = loadJson(path.join(versionDir, capability.response_schema));
    assert.equal(responseSchema.properties.contract_version.const, version);
    assert.equal(responseSchema.properties.capability_id.const, capability.id);
    assert.equal(responseSchema.properties.source.properties.dataset.const, expectedDatasets[capability.id], `${capability.id}: source must name the canonical SIIO read model/table`);
    assert.equal(responseSchema.properties.source.properties.persisted.const, agentId === 'AGT-002', `${capability.id}: persisted marker must reflect the canonical producer`);
    assert.ok(!responseSchema.properties.source.properties.dataset.const.endsWith('_snapshot'), `${capability.id}: invented snapshot datasets are forbidden`);
    for (const field of collectPropertyNames(responseSchema)) {
      if (field !== 'is_approved') {
        for (const fragment of prohibitedOperationFieldFragments) {
          assert.ok(!field.includes(fragment), `${capability.id}: response must not expose prohibited operational field ${field}`);
        }
      }
      assert.ok(!sensitiveResponseFields.has(field), `${capability.id}: response must not expose sensitive field ${field}`);
    }
    for (const field of ['correlation_id', 'run_id', 'policy_version', 'source', 'cutoff_at', 'evidence', 'data']) {
      assert.ok(responseSchema.required.includes(field), `${capability.id}: response requires ${field}`);
    }
  }

  const errorSchema = loadJson(path.join(versionDir, 'error.schema.json'));
  for (const field of ['contract_version', 'capability_id', 'correlation_id', 'run_id', 'policy_version', 'source', 'cutoff_at', 'evidence', 'error']) {
    assert.ok(errorSchema.required.includes(field), `${agentId}: error envelope requires ${field}`);
  }
  assert.ok(errorSchema.properties.error.properties.code.enum.length >= 4, `${agentId}: stable typed errors required`);
  assert.equal(errorSchema.properties.error.properties.retryable.type, 'boolean');

  for (const fixture of manifest.fixtures) {
    assert.equal(path.dirname(fixture.path), 'fixtures', `${agentId}: fixtures must stay under fixtures/`);
    assert.equal(path.dirname(fixture.schema), '.', `${agentId}: fixture schema must stay under v1/`);
    const fixturePath = path.join(versionDir, fixture.path);
    const schemaPath = path.join(versionDir, fixture.schema);
    assert.ok(existsSync(fixturePath), `${fixture.path}: fixture must exist`);
    assert.ok(existsSync(schemaPath), `${fixture.schema}: fixture schema must exist`);
    const payload = loadJson(fixturePath);
    const errors = validate(loadJson(schemaPath), payload);
    if (fixture.valid) assert.deepEqual(errors, [], `${fixture.path}: expected valid fixture; ${errors.join('; ')}`);
    else assert.ok(errors.length > 0, `${fixture.path}: expected invalid fixture to be rejected`);
    assertSyntheticFixture(payload);
  }

  for (const file of walkFiles(versionDir)) {
    if (!file.endsWith('.json')) continue;
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\/root\//, `${file}: local paths forbidden`);
    assert.doesNotMatch(text, /(?:password|secret|token|api[_-]?key)\s*[":=]/i, `${file}: secret-like fields forbidden`);
  }
}

assert.deepEqual(allManifestCapabilities, [...allowedCapabilities], 'manifests must expose exactly the P1A allowlist');

const vigiaRuntime = readFileSync(path.join(repoRoot, 'vigia-engine.js'), 'utf8');
const vigiaRequest = loadJson(path.join(contractsRoot, 'AGT-003', 'v1', 'priorities.request.schema.json'));
assert.deepEqual(vigiaRequest.properties.query.properties, {}, 'AGT-003 request must not invent filters or pagination');
const vigiaSchema = loadJson(path.join(contractsRoot, 'AGT-003', 'v1', 'priorities.response.schema.json'));
const vigiaData = vigiaSchema.properties.data;
for (const field of ['generated_at', 'source', 'policy', 'totals', 'priorities']) {
  assert.ok(vigiaData.required.includes(field), `AGT-003 canonical payload requires ${field}`);
}
assert.ok(!vigiaData.properties.next_cursor, 'AGT-003 response must not invent pagination absent from the canonical producer');
const vigiaItem = vigiaData.properties.priorities.items;
for (const field of ['id', 'owner_id', 'owner_name', 'company_name', 'customer_segment', 'stage_code', 'stage_name', 'stage_order', 'service_type_code', 'service_type_name', 'regional_nombre', 'offer_value', 'weighted_pipeline_value', 'next_action_at', 'last_interaction_at', 'updated_at', 'created_at', 'expected_close_date', 'score', 'level', 'signal_codes', 'signals', 'recommendation', 'explanation', 'evidence', 'source']) {
  assert.ok(vigiaItem.required.includes(field), `AGT-003 canonical priority requires ${field}`);
}
assert.deepEqual(vigiaItem.properties.level.enum, ['alto', 'medio', 'bajo'], 'priorities must exclude sin_prioridad');
assert.equal(vigiaItem.oneOf?.length, 3, 'AGT-003 must encode score-to-level thresholds');
const canonicalRecommendations = [
  'Revisar la gestión vencida y validar el siguiente paso.',
  'Programar la próxima gestión con validación del responsable.',
  'Revisar la fecha esperada de cierre y el bloqueo comercial.',
  'Validar el bloqueo de la oportunidad estancada.',
  'Completar los datos faltantes antes de la siguiente revisión.',
  'Revisar la prioridad con el responsable comercial.',
];
assert.deepEqual(vigiaItem.properties.recommendation.enum, canonicalRecommendations);
const canonicalSignalPoints = {
  invalid_next_action: 0, missing_next_action: 25, next_action_overdue: 30,
  invalid_activity: 0, stalled_critical: 30, stalled_warning: 15,
  critical_stage: 15, invalid_expected_close: 0, close_overdue: 25,
  close_soon: 10, high_value: 15, value_missing: 10, regional_missing: 5,
};
const signalVariants = vigiaItem.properties.signals.items.oneOf;
assert.equal(signalVariants?.length, Object.keys(canonicalSignalPoints).length, 'all canonical signals need exact variants');
for (const [code, points] of Object.entries(canonicalSignalPoints)) {
  const variant = signalVariants.find(candidate => candidate.properties.code.const === code);
  assert.ok(variant, `missing signal variant ${code}`);
  assert.equal(variant.properties.points.const, points, `${code}: canonical points mismatch`);
}
assert.ok(!vigiaItem.properties.opportunity_id, 'AGT-003 must preserve canonical id instead of inventing opportunity_id');
assert.ok(!vigiaItem.properties.calculation_evidence, 'AGT-003 must preserve canonical evidence field name');
assert.equal(vigiaData.properties.policy.properties.version.const, 'gate0-v1.0');
assert.match(vigiaRuntime, /version: 'gate0-v1\.0'/, 'contract policy version must exist in Vigía runtime');
for (const code of vigiaItem.properties.signal_codes.items.enum) {
  assert.ok(vigiaRuntime.includes(`code: '${code}'`), `AGT-003 signal ${code} must exist in vigia-engine.js`);
}
const vigiaFixture = loadJson(path.join(contractsRoot, 'AGT-003', 'v1', 'fixtures', 'valid-priorities-response.json'));
assert.equal(vigiaFixture.cutoff_at, vigiaFixture.data.source.as_of, 'AGT-003 cutoff must equal the canonical max-visible source cutoff');
for (const priority of vigiaFixture.data.priorities) {
  assert.equal(priority.score, priority.signals.reduce((sum, signal) => sum + signal.points, 0), 'fixture score must equal canonical signal points');
  assert.deepEqual(priority.signal_codes, priority.signals.map(signal => signal.code), 'fixture signal_codes must preserve signal order');
}
const syntheticVigiaRows = [{
  id: 'syn-engine-opportunity-001', owner_id: null, owner_name: null,
  company_name: 'SYNTHETIC_ENTITY', customer_segment: null,
  stage_code: 'synthetic-stage', stage_name: 'SYNTHETIC_STAGE', stage_order: 4,
  service_type_code: null, service_type_name: null, regional_nombre: 'Synthetic Region',
  offer_value: 1000, weighted_pipeline_value: 700,
  next_action_at: '2030-01-01T12:00:00Z', last_interaction_at: '2029-12-01T12:00:00Z',
  updated_at: '2030-02-01T09:59:00Z', created_at: '2029-11-01T12:00:00Z', expected_close_date: null,
}];
const [enginePriority] = prioritizeVigiaOpportunities(syntheticVigiaRows, { now: '2030-02-01T10:00:00Z' });
assert.deepEqual(validate(vigiaItem, enginePriority), [], 'canonical Vigía engine output must validate against the item contract');
assert.equal(enginePriority.score, enginePriority.signals.reduce((sum, signal) => sum + signal.points, 0));

const canonicalDecisions = ['GO condicionado', 'GO condicionado a validación RUP/financiera', 'NO GO temporal / completar documentos', 'DESCARTAR salvo señal comercial externa', 'REVISAR CON LICITACIONES'];
const canonicalRisks = ['Alto', 'Medio-Alto', 'Medio'];
const analysisSchema = loadJson(path.join(contractsRoot, 'AGT-002', 'v1', 'analysis.response.schema.json'));
const analysis = analysisSchema.properties.data.properties.analysis;
for (const field of ['opportunity_id', 'status', 'generated_at', 'recommendation', 'risk', 'summary', 'findings', 'matrix', 'next_action', 'human_review_required']) {
  assert.ok(analysis.required.includes(field), `AGT-002 analysis projection requires ${field}`);
}
assert.equal(analysis.properties.human_review_required.const, true);
assert.deepEqual(analysis.properties.recommendation.enum, canonicalDecisions);
assert.deepEqual(analysis.properties.risk.enum, canonicalRisks);
const invalidAnalysis = loadJson(path.join(contractsRoot, 'AGT-002', 'v1', 'fixtures', 'invalid-analysis-response-noncanonical.json'));
assert.ok(validate(analysisSchema, invalidAnalysis).length > 0, 'analysis must reject invented decision/risk values');

const dossierSchema = loadJson(path.join(contractsRoot, 'AGT-002', 'v1', 'dossier.response.schema.json'));
const dossier = dossierSchema.properties.data.properties.dossier;
for (const field of ['opportunity_id', 'document_count', 'missing_document_count', 'analysis_status', 'human_pending_count', 'dossier_status']) {
  assert.ok(dossier.required.includes(field), `AGT-002 dossier projection requires ${field}`);
}

const serverRuntime = readFileSync(path.join(repoRoot, 'server', 'index.js'), 'utf8');
const goNoGoSchema = loadJson(path.join(contractsRoot, 'AGT-002', 'v1', 'go-no-go-recommendation.response.schema.json'));
const goNoGo = goNoGoSchema.properties.data.properties.go_no_go;
for (const decision of canonicalDecisions) {
  assert.ok(goNoGo.properties.decision.enum.includes(decision), `GO/NO-GO must accept canonical decision ${decision}`);
  assert.ok(serverRuntime.includes(`'${decision}'`), `canonical decision ${decision} must exist in server runtime`);
}
for (const risk of canonicalRisks) assert.ok(goNoGo.properties.risk.enum.includes(risk), `GO/NO-GO must accept canonical risk ${risk}`);
assert.equal(goNoGo.properties.human_review_required.const, true);
assert.equal(goNoGo.properties.is_approved.const, false);

console.log('P1A SIIO agent contracts OK');
