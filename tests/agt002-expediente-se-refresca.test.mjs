import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Arreglo de §8 (4-nov, Supersalud): la Mesa terminó la carta en Word, pero la lista de documentos del expediente
// seguía en la versión anterior y Juan bajó la versión 1. El expediente se vuelve a leer cuando un pedido termina.
const helperUrl = new URL('../src/tenders/workspace/vigiaChannelFailure.ts', import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const job = (id, status) => ({ id, status, created_at: '2026-11-04T22:09:00Z' });

async function helper() {
  const module = await import(helperUrl.href);
  assert.equal(typeof module.newlyCompletedVigiaJobIds, 'function', 'falta newlyCompletedVigiaJobIds');
  return module.newlyCompletedVigiaJobIds;
}

test('caso Supersalud: el borrador pasa de en curso a completado → hay novedad', async () => {
  const newlyCompleted = await helper();
  assert.deepEqual(newlyCompleted([job('carta', 'in_progress')], [job('carta', 'completed')]), ['carta']);
});

test('al abrir la pantalla, lo que ya estaba completado no es novedad; sin cambios tampoco', async () => {
  const newlyCompleted = await helper();
  assert.deepEqual(newlyCompleted(null, [job('viejo', 'completed')]), []);
  assert.deepEqual(newlyCompleted([job('viejo', 'completed')], [job('viejo', 'completed')]), []);
  assert.deepEqual(newlyCompleted([job('a', 'queued')], [job('a', 'failed')]), [], 'un fallo no trae documento nuevo');
});

test('la preparación vuelve a leer el expediente cuando el canal avisa que terminó un pedido', () => {
  assert.ok(existsSync(helperUrl));
  const channel = read('../src/tenders/workspace/TenderVigiaChannel.tsx');
  assert.match(channel, /onJobsCompleted\?: \(\) => unknown/);
  assert.match(channel, /newlyCompletedVigiaJobIds\(previousJobsRef\.current, data\.jobs\)/);
  assert.match(channel, /if \(completed\.length > 0\) onJobsCompleted\?\.\(\);/);
  const workspace = read('../src/tenders/workspace/TenderWorkspace.tsx');
  assert.match(workspace, /<TenderVigiaChannel opportunityId=\{opportunityId\} request=\{request\} onJobsCompleted=\{reload\} \/>/);
});
