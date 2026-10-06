// AGT-002 Radar deep daily search (moved from Hermes into the CRM, owner decision 2026-10-06).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RADAR_DEEP_KEYWORDS, RADAR_UNSPSC_CODES, ELECTRONIC_UNSPSC_FAMILIES, radarDeepKeywordWhere, radarDeepUnspscFamilyWhere,
  radarDeepWindows, evaluateElectronicSecurityPath, isHighValueVigilanceTender, DIRECT_SERVICE_REASON,
} from '../tender-radar-deep-search.js';

test('keeps the Hermes search vocabulary: 77 keywords, 8 UNSPSC codes, 3 electronic families', () => {
  assert.equal(RADAR_DEEP_KEYWORDS.length, 77);
  for (const keyword of ['vigilancia', 'seguridad privada', 'cctv', 'videovigilancia', 'control de acceso', 'vms', 'lectura de placas', 'operador de medios tecnológicos']) {
    assert.ok(RADAR_DEEP_KEYWORDS.includes(keyword), keyword);
  }
  assert.deepEqual(RADAR_UNSPSC_CODES, ['92101500', '92101600', '92101700', '46171500', '46171600', '81112000', '46181500', '92121500']);
  assert.deepEqual(ELECTRONIC_UNSPSC_FAMILIES, ['461715', '461716', '461815']);
});

test('SoQL clauses: every keyword over every name field, UNSPSC only with a category field, quotes escaped', () => {
  const where = radarDeepKeywordWhere(['nombre', 'descripcion'], 'categoria');
  assert.match(where, /lower\(nombre\) like '%vigilancia%' OR lower\(descripcion\) like '%vigilancia%'/);
  assert.match(where, /categoria like '%92101600%'/);
  assert.doesNotMatch(radarDeepKeywordWhere(['nombre']), /categoria/);
  assert.equal(radarDeepUnspscFamilyWhere(null), null);
  assert.match(radarDeepUnspscFamilyWhere('categoria'), /upper\(categoria\) like '%461715%'/);
});

test('60 days in 10-day windows up to today inclusive (SECOP II); one open window when not chunked (SECOP I)', () => {
  const windows = radarDeepWindows(new Date('2026-10-06T21:00:00Z'), { chunkDays: 10 });
  assert.equal(windows[0].start, '2026-08-07');
  assert.equal(windows.at(-1).end, '2026-10-07');
  for (let index = 1; index < windows.length; index += 1) assert.equal(windows[index].start, windows[index - 1].end);
  assert.deepEqual(radarDeepWindows(new Date('2026-10-06T21:00:00Z')), [{ start: '2026-08-07', end: null }]);
});

test('electronic-security path needs value above $10 M, a technology and a service; pure supply never qualifies', () => {
  const row = { nombre: 'Suministro, instalación y mantenimiento de CCTV con VMS para la sede' };
  const ok = evaluateElectronicSecurityPath(row, 300_000_000);
  assert.equal(ok.ok, true);
  assert.equal(ok.score, 110);
  assert.equal(evaluateElectronicSecurityPath(row, 10_000_000).ok, false);
  assert.equal(evaluateElectronicSecurityPath({ nombre: 'Compra de cámaras CCTV' }, 300_000_000).ok, false, 'no service signal');
  assert.equal(evaluateElectronicSecurityPath({ nombre: 'Lectores de libros para la biblioteca' }, 300_000_000).ok, false, 'lector needs a whole word and a service');
  assert.equal(evaluateElectronicSecurityPath({ nombre: 'Electoral services instalación' }, 300_000_000).ok, false);
});

test('vigilance of $1.000 M or more always enters; smaller or non-security does not', () => {
  assert.equal(isHighValueVigilanceTender({ value: 2_000_000_000, title: 'Servicio de vigilancia y seguridad privada' }), true);
  assert.equal(isHighValueVigilanceTender({ value: 900_000_000, title: 'Servicio de vigilancia y seguridad privada' }), false);
  assert.equal(isHighValueVigilanceTender({ value: 2_000_000_000, title: 'Vigilancia epidemiológica' }), false);
  assert.equal(DIRECT_SERVICE_REASON, 'objeto directo de seguridad ofertable');
});

test('the CRM import wires the deep search only for the daily/full import, fail-closed on SECOP, and the button requests it', () => {
  for (const path of ['../api/[...path].js', '../server/index.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /deep \? fetchSecopSourceDeep\(source, cfg\) : fetchSecopSource\(source, cfg\)/);
    assert.match(source, /Importación diaria cancelada/);
    assert.match(source, /export async function persistTenderRadar\(database, actorProfile, mode = 'manual', \{ deep = false \} = \{\}\)/);
    assert.equal(source.split("res.json(await tenderRadarManualSync(database, currentProfile));").length - 1, 2, 'both refresh routes request the full import');
    assert.match(source, /process\.env\.CRM_SKIP_LISTEN !== '1'/);
  }
});
