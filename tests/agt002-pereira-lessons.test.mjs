import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  AGT002_PEREIRA_CASE,
  AGT002_PEREIRA_LESSON_BUCKETS,
  AGT002_PEREIRA_LESSONS,
  buildAgt002PereiraTouchpointIndex,
} from '../agt002-pereira-lessons.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

test('Pereira is a pattern, never proof of Manizales compliance', () => {
  assert.equal(AGT002_PEREIRA_CASE.applies_to_manizales, 'patron_no_prueba');
  assert.equal(AGT002_PEREIRA_CASE.role, 'patron_taxonomia_y_escalera_probatoria');
  assert.match(AGT002_PEREIRA_CASE.not_used_as, /prueba_de_cumplimiento/);
});

test('three separated buckets: universales / variables_por_proceso / postadjudicacion', () => {
  assert.deepEqual(AGT002_PEREIRA_LESSON_BUCKETS, ['universales', 'variables_por_proceso', 'postadjudicacion']);
  for (const bucket of AGT002_PEREIRA_LESSON_BUCKETS) {
    assert.ok(Array.isArray(AGT002_PEREIRA_LESSONS[bucket]) && AGT002_PEREIRA_LESSONS[bucket].length > 0, `${bucket} no vacío`);
  }
});

test('every lesson is requirement -> evidence_type -> observed_result -> lesson, with provenance', () => {
  for (const bucket of AGT002_PEREIRA_LESSON_BUCKETS) {
    for (const entry of AGT002_PEREIRA_LESSONS[bucket]) {
      for (const field of ['requirement', 'evidence_type', 'observed_result', 'lesson', 'confidence']) {
        assert.ok(typeof entry[field] === 'string' && entry[field].trim(), `${bucket}.${field}`);
      }
      assert.ok(entry.provenance && typeof entry.provenance.doc === 'string', 'provenance.doc');
      assert.ok(Array.isArray(entry.provenance.evidence_ids), 'provenance.evidence_ids');
      assert.ok(Array.isArray(entry.manizales_touchpoints), 'manizales_touchpoints');
      assert.ok(Object.isFrozen(entry), 'lección congelada');
    }
  }
});

test('the RCE offer/post-award distinction and the seriedad base-of-calc lesson are present', () => {
  const all = AGT002_PEREIRA_LESSON_BUCKETS.flatMap(b => AGT002_PEREIRA_LESSONS[b]);
  assert.ok(all.some(l => /RCE ≥400 SMMLV.*habilitante.*200 SMMLV/s.test(l.lesson)), 'distinción RCE habilitante vs contractual');
  assert.ok(all.some(l => /10% del total de CDP/.test(l.lesson)), 'base de cálculo garantía POE vs CDP');
});

test('post-award lessons are explicitly not pre-GO evidence', () => {
  assert.ok(AGT002_PEREIRA_LESSONS.postadjudicacion.some(l => /no son evidencia pre-GO|posteriores a la adjudicación/.test(l.lesson)));
});

test('touchpoint index maps section numerals to lessons', () => {
  const index = buildAgt002PereiraTouchpointIndex();
  assert.ok(index.has('2.1'), 'sección habilitante 2.1 con lecciones');
  assert.ok(index.get('2.1').length > 0);
  for (const list of index.values()) {
    for (const item of list) assert.ok(AGT002_PEREIRA_LESSON_BUCKETS.includes(item.bucket));
  }
});

test('lessons carry only institutional identifiers, no open PII', () => {
  assertNoOpenPii(AGT002_PEREIRA_LESSONS);
});
