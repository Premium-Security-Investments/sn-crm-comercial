import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSanitaryV2Baseline,
  validateSanitaryV2Baseline,
} from '../scripts/agt002-manizales-v2-baseline-export.mjs';

const run = {
  id: '4f5f8bcf-6de2-45d9-b74a-4588a514bdf3',
  created_at: '2026-08-12T15:40:49.335995+00:00',
  completed_at: '2026-08-12T15:40:49.335995+00:00',
  status: 'completed',
  producer: 'AGT-002',
  method: 'agent_ai',
  canonical: false,
  critical_open_count: 3,
  schema_version: '2.0-preview.1',
  policy_version: 'agt002-preview-policy-v2',
  result: {
    summary: 'La fecha de cierre y una posible prórroga deben verificarse.',
    questions: [
      { critical: true, text: '¿La licencia de funcionamiento de SuperVigilancia está vigente?' },
      { critical: true, text: 'Validar experiencia, SG-SST y pólizas RCE y vida colectiva.' },
    ],
    weaknesses: ['Capital de trabajo y capacidad financiera pendientes.'],
    blockers: [], strengths: [], unverified: [],
  },
};

test('builds a metadata-only V2 baseline with controlled dimensions and no source prose', () => {
  const fixture = buildSanitaryV2Baseline(run, {
    opportunityId: '54190e51-15fb-46af-b0aa-8f13461a3110',
    generatedAt: '2026-08-15T00:00:00.000Z',
  });
  validateSanitaryV2Baseline(fixture);
  assert.equal(fixture.source_run.schema_version, '2.0-preview.1');
  assert.equal(fixture.source_run.canonical, false);
  assert.equal(fixture.dimensions.closing_or_extension.present, true);
  assert.equal(fixture.dimensions.supervigilancia_license.present, true);
  assert.equal(fixture.dimensions.experience.present, true);
  assert.equal(fixture.dimensions.sst.present, true);
  assert.equal(fixture.dimensions.insurance_package.present, true);
  assert.equal(fixture.dimensions.financial_capacity.present, true);
  const serialized = JSON.stringify(fixture);
  assert.equal(serialized.includes('posible prórroga'), false);
  assert.equal(serialized.includes('licencia de funcionamiento'), false);
});

test('rejects a non-V2 source run', () => {
  assert.throws(
    () => buildSanitaryV2Baseline({ ...run, schema_version: '3.0.0' }, {
      opportunityId: '54190e51-15fb-46af-b0aa-8f13461a3110',
      generatedAt: '2026-08-15T00:00:00.000Z',
    }),
    /schema 2\.x/,
  );
});
