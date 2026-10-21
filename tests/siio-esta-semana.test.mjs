import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { deriveEstaSemana, sinLoUrgente } = await loadModule('../src/siio/estaSemana.ts');

const HOY = '2026-10-21';
const licitacion = (id, fields) => ({
  id, entity: `Entidad ${id}`, total_value: 1_000_000_000, deadline_at: '2026-10-25T00:00:00Z',
  days_to_deadline: 4, decision: null, offer_status: 'pendiente_decision', attention: 'requiere_decision', ...fields,
});
const resumen = calendar => ({
  as_of: HOY,
  sales: {}, pipeline: {},
  tenders: { open_count: calendar.length, total_value: 0, requires_decision: 0, overdue_status: 0, decision_window_days: 21, award_rate: null, awarded: 0, not_awarded: 0, calendar },
  data_quality: {},
});
const seguimiento = (id, fields) => ({
  id, title: `Seguimiento ${id}`, owner_label: 'Gerencia', due_date: '2026-10-23', origin_type: 'licitacion',
  origin_ref: null, origin_label: null, auto_rule: null, status: 'abierto', notes: [], created_role: 'gerencia',
  created_at: '2026-10-01', closed_at: null, close_reason: null, close_evidence: null, ...fields,
});
const lista = followups => ({ followups, permissions: { view: true, create: true, edit: true }, today: HOY });

test('solo sube lo que tiene reloj: vencido o dentro de la ventana', () => {
  const commercial = resumen([
    licitacion('cerca', { days_to_deadline: 2 }),
    licitacion('lejos', { days_to_deadline: 15, deadline_at: '2026-11-05T00:00:00Z' }),
    licitacion('vencida', { days_to_deadline: -14, attention: 'cierre_vencido_sin_actualizar' }),
    licitacion('tranquila', { attention: null, days_to_deadline: 3 }),
  ]);
  const { asuntos, vencidos, ventanaDias } = deriveEstaSemana({ commercial, followups: null, today: HOY });
  assert.equal(ventanaDias, 7);
  assert.deepEqual(asuntos.map(item => item.titulo), ['Entidad vencida', 'Entidad cerca']);
  assert.equal(vencidos, 1);
  assert.equal(asuntos[0].situacion, 'Cerró y el estado no se ha actualizado');
  assert.match(asuntos[0].cuando, /hace 14 días/);
  assert.match(asuntos[1].cuando, /en 2 días/);
});

test('los seguimientos vencidos o que vencen esta semana también suben, y los lejanos no', () => {
  const followups = lista([
    seguimiento('v', { due_date: '2026-10-18' }),
    seguimiento('cerca', { due_date: '2026-10-24' }),
    seguimiento('lejos', { due_date: '2026-11-30' }),
    seguimiento('cumplido', { due_date: '2026-10-19', status: 'cumplido' }),
  ]);
  const { asuntos, vencidos } = deriveEstaSemana({ commercial: null, followups, today: HOY });
  assert.deepEqual(asuntos.map(item => item.titulo), ['Seguimiento v', 'Seguimiento cerca']);
  assert.equal(vencidos, 1);
  assert.equal(asuntos.every(item => item.tipo === 'seguimiento'), true);
});

test('primero lo vencido y después lo que vence antes, mezclando licitaciones y seguimientos', () => {
  const commercial = resumen([licitacion('a', { days_to_deadline: 5 }), licitacion('b', { days_to_deadline: -2, attention: 'cierre_vencido_sin_actualizar' })]);
  const followups = lista([seguimiento('s1', { due_date: '2026-10-22' }), seguimiento('s0', { due_date: '2026-10-10' })]);
  const { asuntos } = deriveEstaSemana({ commercial, followups, today: HOY });
  // Dentro de lo vencido manda lo que lleva más tiempo vencido.
  assert.deepEqual(asuntos.map(item => [item.vencido, item.dias]), [[true, -11], [true, -2], [false, 1], [false, 5]]);
});

test('sin nada con plazo, la franja queda vacía en vez de inventar urgencia', () => {
  const { asuntos, vencidos } = deriveEstaSemana({ commercial: resumen([licitacion('lejos', { days_to_deadline: 30 })]), followups: lista([]), today: HOY });
  assert.deepEqual(asuntos, []);
  assert.equal(vencidos, 0);
});

test('lo que sube a la franja se descuenta del bloque de abajo', () => {
  const commercial = resumen([
    licitacion('cerca', { days_to_deadline: 2 }),
    licitacion('vencida', { days_to_deadline: -14, attention: 'cierre_vencido_sin_actualizar' }),
    licitacion('lejos', { days_to_deadline: 15 }),
  ]);
  const restantes = sinLoUrgente(commercial);
  assert.deepEqual(restantes.tenders.calendar.map(item => item.id), ['lejos']);
  // No se toca nada más del resumen.
  assert.equal(restantes.tenders.decision_window_days, 21);
  assert.equal(commercial.tenders.calendar.length, 3, 'el resumen original no se modifica');
});
