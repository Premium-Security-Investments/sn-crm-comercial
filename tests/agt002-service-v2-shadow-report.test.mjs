import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateTenderFit, TENDER_FIT_POLICY_VERSION } from '../tender-fit-policy.js';
import { evaluateTenderServiceMatrixV2, TENDER_SERVICE_MATRIX_V2_VERSION } from '../tender-service-matrix-v2.js';
import {
  buildAgt002ServiceV2ShadowReport,
  writeAgt002ServiceV2ShadowReport,
} from '../scripts/agt002-service-v2-shadow-report.mjs';

const NOW = '2026-10-01T12:00:00.000Z';
const NOW_SAME_DAY_LATER = '2026-10-01T23:00:00.000Z';
const NOW_NEXT_DAY = '2026-10-02T00:00:00.000Z';

// Fixtures: un ítem por classification + ambigua + exclusión v2, con términos reales de
// tender-fit-policy.js (eje servicio v1) y tender-service-matrix-v2.js (TENDER_SERVICE_MATRIX_V2).
const ITEM_EXCLUSION = { // CURRENT_IN_V2_OUT: v1 detecta física (50); v2 excluye (dura en title) -> 0
  stable_key: 'A-exclusion', title: 'Vigilancia armada y vigilancia tecnologica', description: '',
};
const ITEM_FISICA_OUT_IN = { // CURRENT_OUT_V2_IN: v1 no reconoce "puesto de vigilancia" (0); v2 sí (FISICA/45)
  stable_key: 'B-fisica-out', title: 'Puesto de vigilancia fija en sede institucional', description: '',
  existing_decision: 'candidata',
};
const ITEM_POINTS_CHANGED = { // POINTS_CHANGED: v1 física=50, v2 FISICA=45 (ambos detectan, puntaje distinto)
  stable_key: 'C-points-changed', title: 'Vigilancia armada', description: '', source_url: 'https://example.com/c',
};
const ITEM_AMBIGUA_OUT_IN = { // CURRENT_OUT_V2_IN vía AMBIGUA: v1 no reconoce (0); v2 AMBIGUA/30/POR_VALIDAR
  stable_key: 'D-ambigua-out', title: 'Escolta con armas las 24 horas', description: '',
};
const ITEM_SAME = { // SAME_SERVICE_POINTS: v1 electronico(40) vía "cctv"; v2 SUMINISTRO(40) tras absorción v2
  stable_key: 'E-cctv-same', title: 'Mantenimiento de CCTV', description: '',
};

function fiveItemsShuffled() {
  return [ITEM_SAME, ITEM_POINTS_CHANGED, ITEM_EXCLUSION, ITEM_AMBIGUA_OUT_IN, ITEM_FISICA_OUT_IN];
}

function expectedV1(item) {
  const fit = evaluateTenderFit({ title: item.title, description: item.description }, { nowIso: NOW });
  const servicio = fit.reasons.find(r => r.axis === 'servicio');
  return { service_points: servicio.points, total_score: fit.score, band: fit.band };
}

function expectedV2(item) {
  return evaluateTenderServiceMatrixV2({ title: item.title, description: item.description });
}

test('exports the expected function shape', () => {
  assert.equal(typeof buildAgt002ServiceV2ShadowReport, 'function');
  assert.equal(typeof writeAgt002ServiceV2ShadowReport, 'function');
});

test('array payload and {items} payload produce the identical report', () => {
  const items = fiveItemsShuffled();
  const fromArray = buildAgt002ServiceV2ShadowReport(items, { nowIso: NOW });
  const fromWrapped = buildAgt002ServiceV2ShadowReport({ items }, { nowIso: NOW });
  assert.equal(JSON.stringify(fromArray), JSON.stringify(fromWrapped));
});

test('report top-level shape is exact and pinned', () => {
  const report = buildAgt002ServiceV2ShadowReport(fiveItemsShuffled(), { nowIso: NOW });
  assert.deepEqual(Object.keys(report).sort(), [
    'generated_at', 'items', 'matrix_version', 'policy_version', 'report_version', 'source_count', 'summary',
  ]);
  assert.equal(report.report_version, 'agt002-service-v2-shadow-report-v1');
  assert.equal(report.generated_at, NOW);
  assert.equal(report.source_count, 5);
  assert.equal(report.policy_version, TENDER_FIT_POLICY_VERSION);
  assert.equal(report.matrix_version, TENDER_SERVICE_MATRIX_V2_VERSION);
});

test('items are ordered by stable_key ascending regardless of input order', () => {
  const report = buildAgt002ServiceV2ShadowReport(fiveItemsShuffled(), { nowIso: NOW });
  assert.deepEqual(report.items.map(i => i.stable_key), [
    'A-exclusion', 'B-fisica-out', 'C-points-changed', 'D-ambigua-out', 'E-cctv-same',
  ]);
});

test('item shape is exact and pinned (including nested objects)', () => {
  const report = buildAgt002ServiceV2ShadowReport([ITEM_POINTS_CHANGED], { nowIso: NOW });
  const item = report.items[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'current_v1', 'delta', 'existing_decision', 'service_v2', 'source_url', 'stable_key', 'title',
  ]);
  assert.deepEqual(Object.keys(item.current_v1).sort(), ['band', 'service_points', 'total_score']);
  assert.deepEqual(Object.keys(item.service_v2).sort(), [
    'excluded', 'exclusion_rule', 'family', 'flags', 'points', 'status', 'trace',
  ]);
  assert.deepEqual(Object.keys(item.delta).sort(), ['classification', 'current_detected', 'service_points', 'v2_detected']);
});

test('CURRENT_IN_V2_OUT: v1 detects a service term that v2 hard-excludes from title', () => {
  const report = buildAgt002ServiceV2ShadowReport([ITEM_EXCLUSION], { nowIso: NOW });
  const item = report.items[0];
  assert.equal(item.current_v1.service_points, 50);
  assert.equal(item.service_v2.points, 0);
  assert.equal(item.service_v2.status, 'EXCLUIDA');
  assert.equal(item.service_v2.excluded, true);
  assert.equal(item.service_v2.exclusion_rule, 'dura');
  assert.equal(item.service_v2.family, null);
  assert.equal(item.service_v2.trace.find(t => t.term === 'vigilancia tecnologica')?.verdict, 'excluye');
  assert.equal(item.delta.current_detected, true);
  assert.equal(item.delta.v2_detected, false);
  assert.equal(item.delta.classification, 'CURRENT_IN_V2_OUT');
  assert.equal(item.delta.service_points, -50);
  assert.deepEqual(item.service_v2.flags, ['EXCLUDED']);
});

test('CURRENT_OUT_V2_IN: v2 recognizes a FISICA anchor that v1 does not', () => {
  const report = buildAgt002ServiceV2ShadowReport([ITEM_FISICA_OUT_IN], { nowIso: NOW });
  const item = report.items[0];
  assert.equal(item.current_v1.service_points, 0);
  assert.equal(item.service_v2.points, 45);
  assert.equal(item.service_v2.family, 'FISICA');
  assert.equal(item.service_v2.status, 'EN_ALCANCE');
  assert.equal(item.delta.current_detected, false);
  assert.equal(item.delta.v2_detected, true);
  assert.equal(item.delta.classification, 'CURRENT_OUT_V2_IN');
  assert.equal(item.delta.service_points, 45);
  assert.equal(item.existing_decision, 'candidata');
  assert.deepEqual(item.service_v2.flags, []);
});

test('CURRENT_OUT_V2_IN via AMBIGUA: confirmed by >=2 contexts, no anchor, v1 blind to it', () => {
  const report = buildAgt002ServiceV2ShadowReport([ITEM_AMBIGUA_OUT_IN], { nowIso: NOW });
  const item = report.items[0];
  assert.equal(item.current_v1.service_points, 0);
  assert.equal(item.service_v2.points, 30);
  assert.equal(item.service_v2.family, 'AMBIGUA');
  assert.equal(item.service_v2.status, 'POR_VALIDAR');
  assert.equal(item.delta.classification, 'CURRENT_OUT_V2_IN');
  assert.equal(item.existing_decision, null);
  assert.deepEqual(item.service_v2.flags, ['AMBIGUOUS']);
});

test('SAME_SERVICE_POINTS: v1 electronico(40) and v2 SUMINISTRO(40) agree after absorción v2', () => {
  const report = buildAgt002ServiceV2ShadowReport([ITEM_SAME], { nowIso: NOW });
  const item = report.items[0];
  assert.equal(item.current_v1.service_points, 40);
  assert.equal(item.service_v2.points, 40);
  assert.equal(item.service_v2.family, 'SUMINISTRO');
  assert.equal(item.delta.current_detected, true);
  assert.equal(item.delta.v2_detected, true);
  assert.equal(item.delta.classification, 'SAME_SERVICE_POINTS');
  assert.equal(item.delta.service_points, 0);
  assert.equal(item.service_v2.trace.find(t => t.term === 'cctv')?.verdict, 'absorbida_por_suministro');
  assert.deepEqual(item.service_v2.flags, ['ABSORBED_ELECTRONICA']);
});

test('POINTS_CHANGED: both detect, different points (v1 fisica=50 vs v2 FISICA=45)', () => {
  const report = buildAgt002ServiceV2ShadowReport([ITEM_POINTS_CHANGED], { nowIso: NOW });
  const item = report.items[0];
  assert.equal(item.current_v1.service_points, 50);
  assert.equal(item.service_v2.points, 45);
  assert.equal(item.delta.current_detected, true);
  assert.equal(item.delta.v2_detected, true);
  assert.equal(item.delta.classification, 'POINTS_CHANGED');
  assert.equal(item.delta.service_points, -5);
  assert.equal(item.source_url, 'https://example.com/c');
  assert.deepEqual(item.service_v2.flags, []);
});

test('current_v1/service_v2 cross-check against the real tender-fit-policy + matrix v2 modules', () => {
  const report = buildAgt002ServiceV2ShadowReport(fiveItemsShuffled(), { nowIso: NOW });
  const byKey = Object.fromEntries(report.items.map(i => [i.stable_key, i]));
  for (const item of [ITEM_EXCLUSION, ITEM_FISICA_OUT_IN, ITEM_POINTS_CHANGED, ITEM_AMBIGUA_OUT_IN, ITEM_SAME]) {
    const reported = byKey[item.stable_key];
    const v1 = expectedV1(item);
    const v2 = expectedV2(item);
    assert.deepEqual(reported.current_v1, v1, item.stable_key);
    assert.equal(reported.service_v2.points, v2.points, item.stable_key);
    assert.equal(reported.service_v2.status, v2.status, item.stable_key);
    assert.equal(reported.service_v2.family, v2.family, item.stable_key);
    assert.equal(reported.service_v2.excluded, v2.excluded, item.stable_key);
    assert.equal(reported.service_v2.exclusion_rule, v2.exclusion_rule, item.stable_key);
    assert.deepEqual(reported.service_v2.trace, v2.trace, item.stable_key);
  }
});

test('summary carries explicit zero-valued keys for all classifications/statuses/families', () => {
  const empty = buildAgt002ServiceV2ShadowReport([], { nowIso: NOW });
  assert.equal(empty.source_count, 0);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.summary.classifications, {
    CURRENT_IN_V2_OUT: 0, CURRENT_OUT_V2_IN: 0, SAME_SERVICE_POINTS: 0, POINTS_CHANGED: 0,
  });
  assert.equal(empty.summary.changed_count, 0);
  assert.deepEqual(empty.summary.statuses, { ACTIVA: 0, POR_VALIDAR: 0, FUERA: 0, EXCLUIDA: 0 });
  assert.deepEqual(empty.summary.by_family, { HIBRIDA: 0, ELECTRONICA: 0, FISICA: 0, SUMINISTRO: 0, null: 0 });
});

test('summary tallies the fixture set correctly and changed_count excludes SAME_SERVICE_POINTS', () => {
  const report = buildAgt002ServiceV2ShadowReport(fiveItemsShuffled(), { nowIso: NOW });
  assert.deepEqual(report.summary.classifications, {
    CURRENT_IN_V2_OUT: 1, CURRENT_OUT_V2_IN: 2, SAME_SERVICE_POINTS: 1, POINTS_CHANGED: 1,
  });
  assert.equal(report.summary.changed_count, 4);
  assert.deepEqual(report.summary.statuses, { ACTIVA: 3, POR_VALIDAR: 1, FUERA: 0, EXCLUIDA: 1 });
  assert.deepEqual(report.summary.by_family, { HIBRIDA: 0, ELECTRONICA: 0, FISICA: 2, SUMINISTRO: 1, null: 2 });
});

test('field aliases (object/desc/budget/municipality/department/closing_date/notice_id) resolve like canonical fields', () => {
  const aliased = {
    object: 'Vigilancia armada', desc: 'Guardas de seguridad física', budget: 2_500_000_000,
    municipality: 'Bogotá', department: 'Cundinamarca', closing_date: '2026-10-10', notice_id: 'ALIAS-1',
  };
  const canonical = {
    title: 'Vigilancia armada', description: 'Guardas de seguridad física', value: 2_500_000_000,
    city: 'Bogotá', dept: 'Cundinamarca', deadline_at: '2026-10-10', stable_key: 'ALIAS-1',
  };
  const reportAliased = buildAgt002ServiceV2ShadowReport([aliased], { nowIso: NOW });
  const reportCanonical = buildAgt002ServiceV2ShadowReport([canonical], { nowIso: NOW });
  assert.equal(JSON.stringify(reportAliased.items), JSON.stringify(reportCanonical.items));
  assert.equal(reportAliased.items[0].stable_key, 'ALIAS-1');
  assert.equal(reportAliased.items[0].title, 'Vigilancia armada');
});

test('stable_key alias priority: stable_key > notice_id > id > source_url', () => {
  const byStableKey = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', stable_key: 'K', notice_id: 'N', id: 'I', source_url: 'https://x/s' }], { nowIso: NOW },
  ).items[0];
  assert.equal(byStableKey.stable_key, 'K');

  const byNoticeId = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', notice_id: 'N', id: 'I', source_url: 'https://x/s' }], { nowIso: NOW },
  ).items[0];
  assert.equal(byNoticeId.stable_key, 'N');

  const byId = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', id: 123, source_url: 'https://x/s' }], { nowIso: NOW },
  ).items[0];
  assert.equal(byId.stable_key, '123');

  const bySourceUrl = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', source_url: 'https://x/only' }], { nowIso: NOW },
  ).items[0];
  assert.equal(bySourceUrl.stable_key, 'https://x/only');
  assert.equal(bySourceUrl.source_url, 'https://x/only');
});

test('does not copy arbitrary fields such as secret/password/token into the report', () => {
  const report = buildAgt002ServiceV2ShadowReport([{
    title: 'Vigilancia armada', stable_key: 'SECRET-1',
    secret: 'top-secret-value', password: 'super-password-value', token: 'leaked-token-value',
  }], { nowIso: NOW });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('top-secret-value'));
  assert.ok(!serialized.includes('super-password-value'));
  assert.ok(!serialized.includes('leaked-token-value'));
  assert.deepEqual(Object.keys(report.items[0]).sort(), [
    'current_v1', 'delta', 'existing_decision', 'service_v2', 'source_url', 'stable_key', 'title',
  ]);
});

test('existing_decision passes through verbatim and defaults to null', () => {
  const withDecision = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', stable_key: 'K1', existing_decision: 'descartada' }], { nowIso: NOW },
  ).items[0];
  assert.equal(withDecision.existing_decision, 'descartada');
  const withoutDecision = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', stable_key: 'K2' }], { nowIso: NOW },
  ).items[0];
  assert.equal(withoutDecision.existing_decision, null);
});

test('rejects an invalid or missing nowIso', () => {
  assert.throws(() => buildAgt002ServiceV2ShadowReport([], { nowIso: 'not-a-date' }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport([], {}), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport([], { nowIso: '2026-10-01T00:00:00+05:00' }), /inv[aá]lid/i);
});

test('rejects a payload whose items are not an array', () => {
  assert.throws(() => buildAgt002ServiceV2ShadowReport({ items: 'nope' }, { nowIso: NOW }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport('nope', { nowIso: NOW }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport(42, { nowIso: NOW }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport(null, { nowIso: NOW }), /inv[aá]lid/i);
});

test('rejects a non-object item inside the items array', () => {
  assert.throws(() => buildAgt002ServiceV2ShadowReport([null], { nowIso: NOW }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport(['string-item'], { nowIso: NOW }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport([42], { nowIso: NOW }), /inv[aá]lid/i);
  assert.throws(() => buildAgt002ServiceV2ShadowReport([['nested']], { nowIso: NOW }), /inv[aá]lid/i);
});

test('determinism: identical input produces an identical serialized report', () => {
  const a = buildAgt002ServiceV2ShadowReport(fiveItemsShuffled(), { nowIso: NOW });
  const b = buildAgt002ServiceV2ShadowReport(fiveItemsShuffled(), { nowIso: NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('writer creates outputDir, writes an atomic dated file and an identical latest.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agt002-svc-v2-shadow-'));
  const outputDir = join(root, 'nested', 'reports');
  try {
    const result = await writeAgt002ServiceV2ShadowReport({ payload: fiveItemsShuffled(), nowIso: NOW, outputDir });
    assert.deepEqual(Object.keys(result).sort(), ['paths', 'report']);
    assert.deepEqual(Object.keys(result.paths).sort(), ['dated', 'latest']);
    assert.equal(result.paths.dated, join(outputDir, '2026-10-01.json'));
    assert.equal(result.paths.latest, join(outputDir, 'latest.json'));

    const datedContent = await readFile(result.paths.dated, 'utf8');
    const latestContent = await readFile(result.paths.latest, 'utf8');
    assert.equal(datedContent, latestContent);
    assert.ok(datedContent.endsWith('\n'));
    assert.deepEqual(JSON.parse(datedContent), result.report);

    const entries = await readdir(outputDir);
    assert.deepEqual(entries.sort(), ['2026-10-01.json', 'latest.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writer rerun same day replaces the dated file; rerun next day preserves the previous day', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agt002-svc-v2-shadow-'));
  const outputDir = join(root, 'reports');
  try {
    const run1 = await writeAgt002ServiceV2ShadowReport({ payload: fiveItemsShuffled(), nowIso: NOW, outputDir });
    const day1Path = run1.paths.dated;
    const day1ContentRun1 = await readFile(day1Path, 'utf8');

    const run2 = await writeAgt002ServiceV2ShadowReport({ payload: [ITEM_SAME], nowIso: NOW_SAME_DAY_LATER, outputDir });
    assert.equal(run2.paths.dated, day1Path, 'same calendar day must map to the same dated file');
    const day1ContentRun2 = await readFile(day1Path, 'utf8');
    assert.notEqual(day1ContentRun2, day1ContentRun1, 'rerun same day must replace the dated file content');
    assert.equal(await readFile(run2.paths.latest, 'utf8'), day1ContentRun2);

    const run3 = await writeAgt002ServiceV2ShadowReport({ payload: [ITEM_POINTS_CHANGED], nowIso: NOW_NEXT_DAY, outputDir });
    assert.notEqual(run3.paths.dated, day1Path, 'a new calendar day must produce a new dated file');
    assert.equal(await readFile(day1Path, 'utf8'), day1ContentRun2, 'the previous day file must be preserved untouched');
    const day2Content = await readFile(run3.paths.dated, 'utf8');
    assert.equal(await readFile(run3.paths.latest, 'utf8'), day2Content, 'latest.json must track the most recent run');

    const entries = await readdir(outputDir);
    assert.deepEqual(entries.sort(), ['2026-10-01.json', '2026-10-02.json', 'latest.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writer rejects an empty or missing outputDir, and invalid payload/nowIso', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agt002-svc-v2-shadow-'));
  try {
    await assert.rejects(
      writeAgt002ServiceV2ShadowReport({ payload: [], nowIso: NOW, outputDir: '' }), /inv[aá]lid/i,
    );
    await assert.rejects(
      writeAgt002ServiceV2ShadowReport({ payload: [], nowIso: NOW }), /inv[aá]lid/i,
    );
    await assert.rejects(
      writeAgt002ServiceV2ShadowReport({ payload: 42, nowIso: NOW, outputDir: join(root, 'x') }), /inv[aá]lid/i,
    );
    await assert.rejects(
      writeAgt002ServiceV2ShadowReport({ payload: [], nowIso: 'not-a-date', outputDir: join(root, 'x') }), /inv[aá]lid/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('field aliases ignore null/undefined values and fall back to the next alias', () => {
  const aliasedWithNulls = {
    title: null, object: 'Vigilancia armada',
    stable_key: null, notice_id: 'N-NULL',
    description: null, desc: 'Guardas',
    value: null, contract_value: 2_500_000_000,
    city: null, municipality: 'Bogotá',
    dept: null, department: 'Cundinamarca',
    deadline_at: null, deadline: '2026-10-10',
    source_url: null,
  };
  const canonical = {
    title: 'Vigilancia armada', stable_key: 'N-NULL', description: 'Guardas',
    value: 2_500_000_000, city: 'Bogotá', dept: 'Cundinamarca', deadline_at: '2026-10-10',
    source_url: null,
  };
  const reportAliased = buildAgt002ServiceV2ShadowReport([aliasedWithNulls], { nowIso: NOW });
  const reportCanonical = buildAgt002ServiceV2ShadowReport([canonical], { nowIso: NOW });
  assert.equal(JSON.stringify(reportAliased.items), JSON.stringify(reportCanonical.items));
  assert.equal(reportAliased.items[0].stable_key, 'N-NULL');
  assert.equal(reportAliased.items[0].title, 'Vigilancia armada');
});

test('field aliases also support name/summary/contract_value/deadline', () => {
  const aliased = {
    name: 'Vigilancia armada', summary: 'Guardas de seguridad física', contract_value: 2_500_000_000,
    deadline: '2026-10-10', stable_key: 'ALIAS-2',
  };
  const canonical = {
    title: 'Vigilancia armada', description: 'Guardas de seguridad física', value: 2_500_000_000,
    deadline_at: '2026-10-10', stable_key: 'ALIAS-2',
  };
  const reportAliased = buildAgt002ServiceV2ShadowReport([aliased], { nowIso: NOW });
  const reportCanonical = buildAgt002ServiceV2ShadowReport([canonical], { nowIso: NOW });
  assert.equal(JSON.stringify(reportAliased.items), JSON.stringify(reportCanonical.items));
  assert.equal(reportAliased.items[0].current_v1.service_points, reportCanonical.items[0].current_v1.service_points);
});

test('source_url and existing_decision normalize to a safe string when given an object, and null stays null', () => {
  const withNulls = buildAgt002ServiceV2ShadowReport(
    [{ title: 'x', stable_key: 'NULL-1', source_url: null, existing_decision: null }], { nowIso: NOW },
  ).items[0];
  assert.equal(withNulls.source_url, null);
  assert.equal(withNulls.existing_decision, null);

  const withObjects = buildAgt002ServiceV2ShadowReport(
    [{
      title: 'x', stable_key: 'OBJ-1',
      source_url: { secret: 'leaked-url-secret' },
      existing_decision: { secret: 'leaked-decision-secret' },
    }], { nowIso: NOW },
  ).items[0];
  assert.equal(withObjects.source_url, '[object Object]');
  assert.equal(withObjects.existing_decision, '[object Object]');
  const serialized = JSON.stringify(withObjects);
  assert.ok(!serialized.includes('leaked-url-secret'));
  assert.ok(!serialized.includes('leaked-decision-secret'));
});

test('real secop_psi_radar_latest.json shape (value_cop/deadline/url/decision) resolves identically to its canonical equivalent', () => {
  // Forma real persistida en /root/.hermes/state/secop_psi_radar_latest.json.
  const psiRadarItem = {
    stable_key: 'PSI-1',
    title: 'Vigilancia armada',
    description: 'Guardas de seguridad física',
    value_cop: 2_500_000_000,
    deadline: '2026-10-10',
    city: 'Bogotá',
    dept: 'Cundinamarca',
    url: 'https://secop.gov.co/x',
    decision: 'candidata',
  };
  const canonicalEquivalent = {
    stable_key: 'PSI-1',
    title: 'Vigilancia armada',
    description: 'Guardas de seguridad física',
    value: 2_500_000_000,
    deadline_at: '2026-10-10',
    city: 'Bogotá',
    dept: 'Cundinamarca',
    source_url: 'https://secop.gov.co/x',
    existing_decision: 'candidata',
  };

  const fromPsiRadar = buildAgt002ServiceV2ShadowReport([psiRadarItem], { nowIso: NOW }).items[0];
  const fromCanonical = buildAgt002ServiceV2ShadowReport([canonicalEquivalent], { nowIso: NOW }).items[0];

  // value_cop debe alimentar el eje escala_comercial igual que value, cambiando total_score/band.
  assert.equal(
    fromPsiRadar.current_v1.total_score, fromCanonical.current_v1.total_score,
    'value_cop must feed current_v1.total_score like its canonical "value" equivalent',
  );
  assert.equal(
    fromPsiRadar.current_v1.band, fromCanonical.current_v1.band,
    'value_cop must feed current_v1.band like its canonical "value" equivalent',
  );

  // url debe llenar source_url, decision debe llenar existing_decision.
  assert.equal(fromPsiRadar.source_url, canonicalEquivalent.source_url, 'url must resolve to source_url');
  assert.equal(fromPsiRadar.existing_decision, canonicalEquivalent.existing_decision, 'decision must resolve to existing_decision');

  assert.deepEqual(
    fromPsiRadar, fromCanonical,
    'the secop_psi_radar_latest.json item shape must produce the exact same report item as its canonical equivalent',
  );
});

test('buildReportItem sources v2 from fit.shadow.servicio_v2 and does not call evaluateTenderServiceMatrixV2 directly', async () => {
  const scriptUrl = new URL('../scripts/agt002-service-v2-shadow-report.mjs', import.meta.url);
  const source = await readFile(scriptUrl, 'utf8');
  const match = source.match(/function buildReportItem\([\s\S]*?\n}\n/);
  assert.ok(match, 'buildReportItem function not found in source');
  const body = match[0];
  assert.ok(
    body.includes('fit.shadow.servicio_v2'),
    'buildReportItem must read the v2 result from fit.shadow.servicio_v2 instead of recomputing it',
  );
  assert.ok(
    !/evaluateTenderServiceMatrixV2\s*\(/.test(body),
    'buildReportItem must not call evaluateTenderServiceMatrixV2 directly; it must reuse the shadow result embedded by evaluateTenderFit',
  );
});
