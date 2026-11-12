// Juan, 2026-11-12: lo que pasó a Seguimiento o se convirtió en oportunidad sale del Radar («no tiene sentido que estén
// en dos lugares»). Lo nuevo y lo descartado siguen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSync } from 'esbuild';

const bundled = buildSync({ entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { deduplicateTenders, onlyRadarCandidates } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);

const tender = (id, internal_status, extra = {}) => ({ id, stable_key: id, entity: `Entidad ${id}`, ref: `REF-${id}`, source: 'SECOP II', title: 'Vigilancia', internal_status, ...extra });

test('el Radar no muestra lo que está en Seguimiento ni lo convertido en oportunidad', () => {
  const rows = [tender('a', 'nueva'), tender('b', 'en_revision'), tender('c', 'convertida_oportunidad'), tender('d', 'descartada'), tender('e', undefined)];
  assert.deepEqual(onlyRadarCandidates(rows).map(row => row.id), ['a', 'd', 'e']);
});

test('si una copia duplicada ya está convertida, sale el grupo entero', () => {
  const twin = { entity: 'Fiscalía', ref: 'FGN-0058', source: 'SECOP II' };
  const rows = [tender('x1', 'nueva', twin), tender('x2', 'convertida_oportunidad', twin)];
  assert.deepEqual(onlyRadarCandidates(deduplicateTenders(rows)), []);
});

test('el Radar filtra después de agrupar', () => {
  const view = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
  assert.ok(view.includes('onlyRadarCandidates(deduplicateTenders(payload?.tenders || []))'));
});
