import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildTenderOpenBoard } from '../verticales/licitaciones/tender-open-board.js';

const bridgeRow = (key, label, state, extra = {}) => ({ key, label, owner: 'Licitaciones', kind: key === 'rup' ? 'mixto' : 'tramite', state, expires_at: null, age_at_close_days: null, document: null, ...extra });
const support = key => ({ key });
const matrixRow = (key, title, demand, keys = [], status = 'por_confirmar') => ({ key, title, demand, status, company_support: keys.map(support) });

// Los dos casos reales del encargo (2026-10-31), con los textos del análisis vigente.
const terminal = {
  opportunity_id: 'tt', ref: 'TT-SPO-07-2026', entity: 'Terminal', close_date: '2026-11-04',
  bridge: { rows: [bridgeRow('rup', 'RUP', 'sin_archivo'), bridgeRow('bank_certificate', 'Certificación bancaria', 'vence_antes_del_cierre', { expires_at: '2026-11-03' })] },
  matrix: { rows: [
    matrixRow('CLM-RUP', 'RUP vigente y en firme', 'RUP expedido desde el 5 de octubre.', ['rup']),
    matrixRow('CLM-BANCO', 'Certificación bancaria', 'Certificación bancaria de máximo 30 días.', ['bank_certificate']),
    matrixRow('CLM-SER', 'Garantía de seriedad', 'Garantía de seriedad de la oferta: póliza por el 12% del presupuesto oficial.'),
  ] },
};
const supersalud = {
  opportunity_id: 'sns', ref: 'SNS-LP-2-2026', entity: 'Supersalud', close_date: '2026-11-05',
  bridge: { rows: [bridgeRow('rup', 'RUP', 'sin_archivo'), bridgeRow('bank_certificate', 'Certificación bancaria', 'vence_antes_del_cierre', { expires_at: '2026-11-03' })] },
  matrix: { rows: [
    matrixRow('CLM-RUP', 'RUP', 'RUP expedido desde el 6 de octubre.', ['rup']),
    matrixRow('CLM-SER', 'Garantía de seriedad', 'La garantía de seriedad de la oferta debe ser del 10 % del presupuesto oficial (unos $1.801.956.668).'),
    matrixRow('CLM-HORAS', 'Horas extras', 'Eliminado.', ['overtime_authorization'], 'no_aplica'),
  ] },
};
const fiscalia = {
  opportunity_id: 'fgn', ref: 'FGN-0058', entity: 'Fiscalía', close_date: '2026-11-12',
  bridge: { rows: [bridgeRow('rup', 'RUP', 'sin_archivo')] },
  matrix: { rows: [matrixRow('CLM-SER', 'Garantía de seriedad', 'La garantía de seriedad de la oferta es del 10 % del presupuesto oficial.')] },
};
const sinAnalisis = { opportunity_id: 'x', ref: 'SIC 23', close_date: '2026-11-23', bridge: { rows: [bridgeRow('bank_certificate', 'Certificación bancaria', 'vencido', { expires_at: '2026-10-01' })] }, matrix: null };

test('un trámite que piden varias licitaciones se dice una vez, con todas', () => {
  const board = buildTenderOpenBoard({ processes: [supersalud, terminal, fiscalia] });
  const rup = board.tramites.find(item => item.key === 'rup');
  assert.deepEqual(rup.processes.map(item => item.ref), ['TT-SPO-07-2026', 'SNS-LP-2-2026'], 'Fiscalía no lo pide en su matriz: no entra');
  assert.equal(rup.first_close, '2026-11-04');
  assert.match(rup.note, /Un solo trámite sirve para 2 licitaciones \(TT-SPO-07-2026, SNS-LP-2-2026\)/);
  assert.equal(board.summary.tramites_compartidos, 1, 'la certificación bancaria sólo la pide Terminal');
});

test('lo que no aplica en un proceso no se le cobra', () => {
  const board = buildTenderOpenBoard({ processes: [supersalud] });
  assert.equal(board.tramites.some(item => item.key === 'overtime_authorization'), false);
});

test('qué vence antes de qué cierre, en un renglón por documento', () => {
  const board = buildTenderOpenBoard({ processes: [terminal, supersalud, sinAnalisis] });
  const bank = board.vencimientos.find(item => item.key === 'bank_certificate');
  assert.deepEqual(bank.processes.map(item => item.ref), ['TT-SPO-07-2026', 'SIC 23'], 'Supersalud no la pide; sin análisis entra todo el catálogo');
  assert.equal(board.summary.sin_analisis, 1);
});

test('las garantías de seriedad con cierres casi simultáneos salen juntas, con su monto si está escrito', () => {
  const board = buildTenderOpenBoard({ processes: [fiscalia, supersalud, terminal] });
  assert.equal(board.por_proceso.items.length, 3);
  assert.equal(board.por_proceso.items.find(item => item.ref === 'SNS-LP-2-2026').amount_text, '$1.801.956.668');
  assert.equal(board.por_proceso.clusters.length, 1, 'Fiscalía cierra 7 días después: va sola');
  const [cluster] = board.por_proceso.clusters;
  assert.deepEqual(cluster.processes, ['TT-SPO-07-2026', 'SNS-LP-2-2026']);
  assert.match(cluster.note, /2 garantías de seriedad para cierres con 1 día de diferencia/);
  assert.match(cluster.note, /SNS-LP-2-2026: \$1\.801\.956\.668/);
});

test('sin procesos, un tablero vacío y no un error', () => {
  const board = buildTenderOpenBoard();
  assert.deepEqual(board.summary, { procesos: 0, sin_analisis: 0, tramites_compartidos: 0, tramites_por_hacer: 0, documentos_que_vencen: 0, garantias_simultaneas: 0, vencidos_que_tumban: 0, no_subsanables_abiertos: 0 });
});

// Mejora 1 (Juan, 2026-11-05: sólo en la plataforma): cada proceso del tablero trae sus vencidos por consecuencia, con
// la misma regla que Preparar (`tender-dossier-vencidos.js`).
import { overdueSummary } from '../verticales/licitaciones/tender-dossier-vencidos.js';
import { buildTenderOpenBoard as buildBoardConVencidos } from '../verticales/licitaciones/tender-open-board.js';
import { readFileSync as readSource } from 'node:fs';

test('mejora 1: el tablero lleva los vencidos de cada proceso y el total de los que tumban una oferta', () => {
  const items = [
    { id: 'a', title: 'Financiero · Garantía de seriedad — CAUSA RECHAZO', instruction: 'No presentarla no se puede subsanar.', status: 'pendiente', required: true, applicability: 'requerido', item_type: 'pendiente_humano', target_date: '2026-10-31', assignee_name: 'Katherine' },
    { id: 'b', title: 'Licitaciones · Experiencia', status: 'en_progreso', required: true, applicability: 'requerido', item_type: 'pendiente_humano', target_date: '2026-11-01', assignee_name: null },
    { id: 'c', title: 'Jurídico · RUT — CAUSA RECHAZO', status: 'listo', required: true, applicability: 'requerido', item_type: 'pendiente_humano', target_date: '2026-10-30' },
  ];
  const vencidos = overdueSummary(items, '2026-11-03');
  assert.deepEqual({ ...vencidos, primeros: vencidos.primeros.map(p => [p.consecuencia, p.dias_vencido]) },
    { vencidos: 2, vencidos_que_tumban: 1, no_subsanables_abiertos: 1, primeros: [['no_subsanable', 3], ['obligatorio', 2]] });
  assert.equal(vencidos.primeros[0].titulo, 'Financiero · Garantía de seriedad');
  const board = buildBoardConVencidos({ processes: [{ opportunity_id: 'o1', ref: 'TT-SPO-07-2026', entity: 'Terminal', close_date: '2026-11-04', bridge: null, matrix: null, vencidos }] });
  assert.equal(board.processes[0].vencidos.vencidos_que_tumban, 1);
  assert.equal(board.summary.vencidos_que_tumban, 1);
  assert.equal(board.summary.no_subsanables_abiertos, 1);
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    assert.match(readSource(new URL(file, import.meta.url), 'utf8'), /const vencidos = Array\.isArray\(workspace\?\.checklist\) \? overdueSummary\(workspace\.checklist, today\) : null;/);
  }
});
