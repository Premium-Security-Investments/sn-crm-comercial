// F17 (auditoría del piloto Fiscalía; Juan, 2026-11-09, opción A2): sin fecha de observaciones en el análisis, aviso en
// Mi día y en la licitación hasta que se suba el cronograma de SECOP y el análisis la encuentre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cronogramaFaltante } from '../verticales/licitaciones/tender-cronograma-faltante.js';
import { buildTenderOpenBoard } from '../verticales/licitaciones/tender-open-board.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('caso Rama Pereira: sólo publicación y cierre → falta el cronograma; con observaciones, no', () => {
  assert.equal(cronogramaFaltante({ deadlines: [{ kind: 'PUBLICATION' }, { kind: 'SUBMISSION' }] }), true);
  assert.equal(cronogramaFaltante({ deadlines: [{ kind: 'SUBMISSION' }, { kind: 'PROJECT_OBSERVATIONS' }] }), false);
  assert.equal(cronogramaFaltante({ deadlines: [{ kind: 'OBSERVATIONS' }] }), false);
  assert.equal(cronogramaFaltante(null), false, 'sin análisis no se afirma nada');
});

test('el tablero pasa la marca a Mi día', () => {
  const board = buildTenderOpenBoard({ processes: [{ opportunity_id: 'p', close_date: '2026-11-26', cronograma_faltante: true }, { opportunity_id: 'q', close_date: '2026-11-27' }] });
  assert.deepEqual(board.processes.map(row => row.cronograma_faltante), [true, false]);
  const server = read('server/index.js');
  assert.match(server, /cronograma_faltante: Boolean\(report\?\.available && cronogramaFaltante\(report\.report\)\)/);
  assert.equal(server, read('api/[...path].js'));
});

test('Mi día y la licitación muestran el aviso', () => {
  assert.match(read('src/tenders/components/TenderMyDayOverdue.tsx'), /Falta el cronograma de SECOP/);
  const workspace = read('src/tenders/workspace/TenderWorkspace.tsx');
  assert.match(workspace, /cronogramaFaltante\(report\) \?/);
  assert.match(workspace, /if \(!rows\.length\) return missing;/);
});
