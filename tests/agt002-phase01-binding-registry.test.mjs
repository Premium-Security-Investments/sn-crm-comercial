import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_SCHEMA_VERSIONS,
  validateAgt002Phase01Schema,
} from '../agt002-phase01-executable-controls.js';

// Loading throws (ENOENT) until Task 5 Step 3 authors
// contracts/agt002-phase01/v1/binding-registry.schema.json and
// contracts/agt002-phase01/v1/binding-registry.json — this is the intended
// external RED for Step 1. Neither file is created by this step.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1');
const BINDING_REGISTRY_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'binding-registry.schema.json');
const BINDING_REGISTRY_DATA_PATH = path.join(CONTRACTS_DIR, 'binding-registry.json');
const EVIDENCE_FILE_PATH = path.join(CONTRACTS_DIR, 'evidence', 'openapi-live-metadata.json');

const bindingRegistrySchema = JSON.parse(readFileSync(BINDING_REGISTRY_SCHEMA_PATH, 'utf8'));
const bindingRegistryData = JSON.parse(readFileSync(BINDING_REGISTRY_DATA_PATH, 'utf8'));

// Hechos vivos normativos (locators literales, verificados contra el árbol real).
const FACT_LOCATORS = {
  'AGT002-P1-FACT-0001': {
    file: 'supabase/migrations/005_public_tenders_radar.sql',
    lineStart: 27,
    lineEnd: 27,
    snippet: 'converted_opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null',
  },
  'AGT002-P1-FACT-0002': {
    file: 'supabase/migrations/018_tender_tracking_rpc.sql',
    lineStart: 42,
    lineEnd: 44,
    snippet: 'psi_public_tenders_converted_opportunity_id_unique',
  },
  'AGT002-P1-FACT-0003': {
    file: 'supabase/migrations/005_public_tenders_radar.sql',
    lineStart: 26,
    lineEnd: 26,
    snippet: "internal_status text not null default 'nueva' check (internal_status in ('nueva','en_revision','descartada','convertida_oportunidad'))",
  },
  'AGT002-P1-FACT-0004': {
    file: 'supabase/migrations/022_tender_go_no_go_workflow.sql',
    lineStart: 42,
    lineEnd: 48,
    snippet: "'presentada', 'adjudicada', 'no_adjudicada', 'cerrada_no_go'",
  },
  'AGT002-P1-FACT-0005': {
    file: 'supabase/migrations/018_tender_tracking_rpc.sql',
    lineStart: 427,
    lineEnd: 427,
    snippet: "stage_code = 'descartado'",
  },
  'AGT002-P1-FACT-0006': {
    file: 'supabase/migrations/088_tender_opportunity_primary_stage_filters.sql',
    lineStart: 48,
    lineEnd: 48,
    snippet: "in ('cerrada_no_go', 'adjudicada', 'no_adjudicada')",
  },
  'AGT002-P1-FACT-0007': {
    file: 'supabase/migrations/022_tender_go_no_go_workflow.sql',
    lineStart: 38,
    lineEnd: 41,
    snippet: "identity_type is null or identity_type in ('human', 'agent')",
  },
  'AGT002-P1-FACT-0008': {
    file: 'supabase/migrations/019_profile_area_permissions.sql',
    lineStart: 23,
    lineEnd: 23,
    snippet: "'admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta'",
  },
  'AGT002-P1-FACT-0009': {
    file: 'supabase/migrations/019_profile_area_permissions.sql',
    lineStart: 144,
    lineEnd: 150,
    snippet: 'primary key (profile_id, permission_code)',
  },
  'AGT002-P1-FACT-0010': {
    file: 'supabase/migrations/019_profile_area_permissions.sql',
    lineStart: 119,
    lineEnd: 125,
    snippet: 'code text primary key',
  },
  'AGT002-P1-FACT-0011': {
    file: 'supabase/migrations/071_agt002_radar_gate.sql',
    lineStart: 4,
    lineEnd: 4,
    snippet: 'psi_agt002_radar_gate_evaluations',
  },
};

for (const locator of Object.values(FACT_LOCATORS)) {
  locator.locator = `migration://${locator.file}`;
}

const ALL_FACT_IDS = Object.keys(FACT_LOCATORS);

const EXPECTED_BINDINGS = new Map([
  ['BIND-TENDER-OPPORTUNITY-INVERSE', { logicalTerm: 'B', status: 'confirmed_durable' }],
  ['BIND-ENTITY-L', { logicalTerm: 'A', status: 'absent_live' }],
  ['BIND-OPPORTUNITY-TENDER-ID-FORWARD', { logicalTerm: 'B', status: 'absent_live' }],
]);

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

function readLineRange(relativeFilePath, lineStart, lineEnd) {
  const absolutePath = path.join(REPO_ROOT, relativeFilePath);
  const lines = readFileSync(absolutePath, 'utf8').split('\n');
  return lines.slice(lineStart - 1, lineEnd).join('\n');
}

// Group 1
test('binding registry schema: pinned $id/$schema/schema_version const, structural closure, and the data file validates against it', () => {
  assert.equal(
    bindingRegistrySchema.$id,
    'https://seguridadnacional.internal/contracts/agt002-phase01/v1/binding-registry.schema.json',
  );
  assert.equal(bindingRegistrySchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(
    bindingRegistrySchema.properties.schema_version.const,
    AGT002_PHASE01_SCHEMA_VERSIONS.bindingRegistry,
  );

  const offenders = [];
  collectSchemaNodesMissingClosure(bindingRegistrySchema, '', offenders);
  assert.deepEqual(offenders, []);

  const result = validateAgt002Phase01Schema(bindingRegistrySchema, bindingRegistryData);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

// Group 2
test('binding registry data: exactly three binding_id entries with the normative logical_term and status', () => {
  assert.equal(bindingRegistryData.registry_version, 1);
  assert.equal(bindingRegistryData.bindings.length, 3);

  const byId = new Map(bindingRegistryData.bindings.map((binding) => [binding.binding_id, binding]));
  assert.deepEqual([...byId.keys()].sort(), [...EXPECTED_BINDINGS.keys()].sort());

  for (const [bindingId, expected] of EXPECTED_BINDINGS) {
    const binding = byId.get(bindingId);
    assert.equal(binding.logical_term, expected.logicalTerm, bindingId);
    assert.equal(binding.status, expected.status, bindingId);
  }
});

// Group 3
test('binding registry data: anti-invention guard — entity_l and the literal FK are only mentioned by absent_live entries with table/column null and gap_id populated', () => {
  for (const binding of bindingRegistryData.bindings) {
    const serialized = JSON.stringify(binding).toLowerCase();
    const mentionsEntityL = serialized.includes('entity_l');
    const mentionsLiteralForwardFk = serialized.includes('psi_sales_opportunities.tender_id');

    if (binding.status === 'confirmed_durable') {
      assert.equal(mentionsEntityL, false, `${binding.binding_id}: confirmed_durable must not mention entity_l`);
      assert.equal(
        mentionsLiteralForwardFk,
        false,
        `${binding.binding_id}: confirmed_durable must not mention the literal forward FK`,
      );
    }

    if (mentionsEntityL || mentionsLiteralForwardFk) {
      assert.equal(binding.status, 'absent_live', `${binding.binding_id}: gap mention requires status absent_live`);
      assert.ok(
        binding.table === null || binding.column === null,
        `${binding.binding_id}: gap mention requires table or column to be null`,
      );
      assert.ok(
        typeof binding.gap_id === 'string' && binding.gap_id.length > 0,
        `${binding.binding_id}: gap mention requires a populated gap_id`,
      );
    }
  }
});

// Group 4
test('binding registry data: every migration_locator evidence entry is verifiable against the real repo file and together they cover exactly the 11 AGT002-P1-FACT-* facts', () => {
  const coveredFactIds = new Set();

  for (const binding of bindingRegistryData.bindings) {
    for (const evidence of binding.evidence ?? []) {
      if (evidence.kind !== 'migration_locator') continue;

      const expected = FACT_LOCATORS[evidence.fact_id];
      assert.ok(expected, `${binding.binding_id}: unknown fact_id "${evidence.fact_id}" in evidence`);

      assert.equal(evidence.locator, expected.locator, `${binding.binding_id}/${evidence.fact_id}: locator`);
      assert.equal(evidence.line_start, expected.lineStart, `${binding.binding_id}/${evidence.fact_id}: line_start`);
      assert.equal(evidence.line_end, expected.lineEnd, `${binding.binding_id}/${evidence.fact_id}: line_end`);
      assert.equal(evidence.snippet, expected.snippet, `${binding.binding_id}/${evidence.fact_id}: snippet`);

      const rangeText = readLineRange(expected.file, expected.lineStart, expected.lineEnd);
      assert.ok(
        rangeText.includes(expected.snippet),
        `${expected.file}:${expected.lineStart}-${expected.lineEnd} does not contain the declared snippet for ${evidence.fact_id}`,
      );

      coveredFactIds.add(evidence.fact_id);
    }
  }

  assert.deepEqual([...coveredFactIds].sort(), [...ALL_FACT_IDS].sort());
});

// Group 5
test('binding registry data: cutoff_utc/verified_at_utc reconciliation and live_metadata_get.artifact vs evidence file coherence', () => {
  for (const binding of bindingRegistryData.bindings) {
    assert.equal(binding.cutoff_utc, '2026-09-23T00:00:00Z', binding.binding_id);

    const cutoffMs = new Date(binding.cutoff_utc).getTime();
    const verifiedMs = new Date(binding.verified_at_utc).getTime();
    assert.ok(verifiedMs >= cutoffMs, `${binding.binding_id}: verified_at_utc must be >= cutoff_utc`);
    assert.ok(
      verifiedMs - cutoffMs <= 24 * 60 * 60 * 1000,
      `${binding.binding_id}: verified_at_utc must not exceed cutoff_utc by more than 24h`,
    );

    const liveMetadataGet = binding.live_metadata_get;
    assert.equal(liveMetadataGet.method, 'GET', binding.binding_id);
    assert.ok(['attached', 'not_attached'].includes(liveMetadataGet.artifact), binding.binding_id);

    if (liveMetadataGet.artifact === 'attached') {
      assert.ok(
        existsSync(EVIDENCE_FILE_PATH),
        `${binding.binding_id}: artifact=attached requires contracts/agt002-phase01/v1/evidence/openapi-live-metadata.json to exist`,
      );
      assert.equal(liveMetadataGet.observed_at_utc, binding.verified_at_utc, binding.binding_id);
    } else {
      assert.ok(
        !existsSync(EVIDENCE_FILE_PATH),
        `${binding.binding_id}: artifact=not_attached requires contracts/agt002-phase01/v1/evidence/openapi-live-metadata.json to be absent`,
      );
      const hasDurableOpenApiEvidence = (binding.evidence ?? []).some(
        (evidence) => evidence.kind === 'openapi_metadata' && evidence.durable === true,
      );
      assert.equal(hasDurableOpenApiEvidence, false, binding.binding_id);
    }
  }
});

// Group 6
test('binding registry data: the inverse binding declares the real unique constraint, on_delete=set_null and live_endpoint', () => {
  const inverse = bindingRegistryData.bindings.find((b) => b.binding_id === 'BIND-TENDER-OPPORTUNITY-INVERSE');
  assert.ok(inverse, 'BIND-TENDER-OPPORTUNITY-INVERSE must exist');
  assert.equal(inverse.unique_constraint, 'psi_public_tenders_converted_opportunity_id_unique');
  assert.equal(inverse.on_delete, 'set_null');
  assert.equal(inverse.live_endpoint, '/rest/v1/psi_public_tenders');
});

// Group 7
test('binding registry data: no evidence locator uses http(s); only migration://, repo:// and fixture:// schemes are allowed', () => {
  const allowedSchemes = ['migration://', 'repo://', 'fixture://'];
  for (const binding of bindingRegistryData.bindings) {
    for (const evidence of binding.evidence ?? []) {
      assert.ok(
        !/^https?:\/\//.test(evidence.locator),
        `${binding.binding_id}: evidence locator must not use http(s) — ${evidence.locator}`,
      );
      assert.ok(
        allowedSchemes.some((scheme) => evidence.locator.startsWith(scheme)),
        `${binding.binding_id}: unexpected locator scheme — ${evidence.locator}`,
      );
    }
  }
});
