import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { aplicarCierresDelPliego, cierreDelPliego, cierreMandaElPliego, planCierrePliego } from '../verticales/licitaciones/tender-cierre-pliego.js';
import { reconcileTenderSource } from '../verticales/licitaciones/tender-source-reconciliation.js';

// El cierre lo manda el pliego (Juan, 2026-11-15). Caso real: Rama Pereira LP-01-2026, pliego 25-nov 4:00 p. m.; SECOP
// datos abiertos 26-nov, y la conciliación lo movía al 26.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const pereira = [
  { kind: 'OBSERVATIONS', value: '2026-11-18T18:00:00-05:00', certainty: 'INFERRED' },
  { kind: 'SUBMISSION', value: '2026-11-25T16:00:00-05:00', certainty: 'CONFIRMED', label: 'Presentación de Ofertas' },
];

test('el cierre del pliego es la presentación de ofertas confirmada', () => {
  assert.deepEqual(cierreDelPliego(pereira), { value: '2026-11-25T16:00:00-05:00', deadline_at: '2026-11-25T21:00:00.000Z', day: '2026-11-25', label: 'Presentación de Ofertas' });
  assert.equal(cierreDelPliego([{ kind: 'SUBMISSION', value: '2026-11-25T16:00:00-05:00', certainty: 'INFERRED' }]), null, 'inferida no manda');
  assert.equal(cierreDelPliego([...pereira, { kind: 'SUBMISSION', value: '2026-11-26T09:00:00-05:00', certainty: 'CONFIRMED' }]), null, 'dos confirmadas distintas: no se escoge');
});

test('el plan marca la fila y guarda lo que había', () => {
  const row = { deadline_at: '2026-11-26T00:00:00+00:00', raw: { deadline: '2026-11-26', entidad: 'Rama' } };
  const patch = planCierrePliego(row, cierreDelPliego(pereira), { analysisRunId: 'run-1', now: '2026-11-15T19:00:00Z' });
  assert.equal(patch.deadline_at, '2026-11-25T21:00:00.000Z');
  assert.equal(patch.raw.deadline, '2026-11-25');
  assert.equal(patch.raw.deadline_source, 'pliego');
  assert.equal(patch.raw.entidad, 'Rama');
  assert.equal(patch.raw.deadline_pliego.previous_raw_deadline, '2026-11-26');
  assert.equal(planCierrePliego({ deadline_at: patch.deadline_at, raw: patch.raw }, cierreDelPliego(pereira)), null, 'ya aplicado: no reescribe');
});

test('con el pliego mandando, SECOP no mueve el cierre: queda la diferencia anotada', () => {
  const existing = { deadline_at: '2026-11-25T21:00:00+00:00', raw: { deadline: '2026-11-25', deadline_source: 'pliego' } };
  const { patch } = reconcileTenderSource(existing, { fecha_de_recepcion_de: '2026-11-26T00:00:00.000' }, { now: '2026-11-16T14:00:00Z' });
  assert.equal(Object.hasOwn(patch, 'deadline_at'), false);
  assert.equal(patch.raw.deadline, '2026-11-25');
  assert.equal(patch.raw.deadline_source, 'pliego');
  assert.equal(patch.raw.deadline_conflicts.length, 1);
  assert.equal(patch.raw.deadline_conflicts[0].manda, 'pliego');
  const again = reconcileTenderSource({ ...existing, raw: patch.raw }, { fecha_de_recepcion_de: '2026-11-26T00:00:00.000' }, { now: '2026-11-17T14:00:00Z' });
  assert.equal(again.patch.raw.deadline_conflicts.length, 1, 'la misma diferencia no se repite cada día');
  // Sin la marca, la regla de siempre: una fecha posterior de la fuente se aplica.
  const free = reconcileTenderSource({ deadline_at: '2026-11-25T21:00:00+00:00', raw: { deadline: '2026-11-25' } }, { fecha_de_recepcion_de: '2026-11-26T00:00:00.000' }, { now: '2026-11-16T14:00:00Z' });
  assert.equal(free.patch.deadline_at, '2026-11-26T00:00:00+00:00');
  assert.equal(cierreMandaElPliego(free.patch.raw), false);
});

test('aplicar: escribe la fila del Radar y la fecha de cierre de la oportunidad', async () => {
  const writes = [];
  const tables = {
    psi_public_tenders: [{ id: 't1', deadline_at: '2026-11-26T00:00:00+00:00', raw: { deadline: '2026-11-26' }, converted_opportunity_id: 'o1' }],
    psi_sales_opportunities: [{ id: 'o1', expected_close_date: '2026-11-26' }],
    psi_agt002_initial_analysis_jobs: [],
  };
  const query = table => {
    const q = {
      select: () => q, eq: () => q, not: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      update: patch => ({ eq: async (_column, id) => { writes.push({ table, id, patch }); return { error: null }; } }),
      then: (resolve, reject) => Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject),
    };
    return q;
  };
  const summary = await aplicarCierresDelPliego({ from: query });
  // Sin análisis listo no se escribe nada: el pliego sólo manda cuando Vig-IA lo leyó.
  assert.deepEqual(summary, { revisadas: 1, aplicadas: 0, sin_cierre_confirmado: 1, errores: [] });
  assert.deepEqual(writes, []);
});

test('la revisión de fases y el trabajo diario respetan la regla', () => {
  const server = read('../server/index.js');
  assert.equal(server, read('../api/[...path].js'));
  assert.match(server, /override\.deadline_at && !cierreMandaElPliego\(row\.raw\)/);
  assert.match(server, /patch\.deadline && !pliego\.has\(opportunity\.id\)/);
  const runner = read('../ops/agt002-radar-reconciliation/run-agt002-radar-reconciliation.mjs');
  assert.ok(runner.indexOf('aplicarCierresDelPliego(database)') < runner.indexOf('reconciliation.runOnce()'), 'el pliego va antes que SECOP');
});
