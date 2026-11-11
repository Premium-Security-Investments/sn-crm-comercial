// Revisión de los trabajos del servidor (Juan, 2026-11-11): un reloj por grupo de pasos, no uno por paso. Cada paso
// sigue siendo su propia unidad (usuario, entorno y sandbox propios); el reloj del grupo la arranca con Wants/After.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const gone = path => !existsSync(new URL(`../${path}`, import.meta.url));

test('análisis: el reloj del worker arranca antes la admisión automática, cada 2 minutos', () => {
  const unit = read('ops/agt002-initial-analysis-worker/agt002-initial-analysis-worker.service');
  assert.match(unit, /^Wants=agt002-auto-initial\.service$/m);
  assert.match(unit, /^After=agt002-auto-initial\.service$/m);
  assert.match(read('ops/agt002-initial-analysis-worker/agt002-initial-analysis-worker.timer'), /^OnUnitInactiveSec=120$/m);
  assert.ok(gone('ops/agt002-auto-initial/agt002-auto-initial.timer'), 'la admisión ya no tiene reloj propio');
});

test('pedidos: el reloj de borradores arranca el archivo de estudios y SecurityOps, cada 5 minutos', () => {
  const unit = read('ops/agt002-sharepoint-bridge/agt002-sharepoint-drafts.service');
  assert.match(unit, /^Wants=estudios-seguridad-archivo\.service estudios-seguridad-securityops\.service$/m);
  assert.match(unit, /^After=estudios-seguridad-archivo\.service estudios-seguridad-securityops\.service$/m);
  assert.match(read('ops/agt002-sharepoint-bridge/agt002-sharepoint-drafts.timer'), /^OnUnitInactiveSec=300s$/m);
  assert.ok(gone('ops/estudios-seguridad/estudios-seguridad-archivo.timer'));
  assert.ok(gone('ops/estudios-seguridad/estudios-seguridad-securityops.timer'));
  // Cada uno conserva su sandbox: la sesión de Graph no se mezcla con la llave de SecurityOps.
  assert.doesNotMatch(unit, /vigia-firestore/);
  assert.doesNotMatch(read('ops/estudios-seguridad/estudios-seguridad-securityops.service'), /vigia-graph/);
});

test('sincronizar fuentes: sigue aparte, cada 5 minutos', () => {
  assert.match(read('ops/agt002-radar-daily/agt002-radar-requests.timer'), /^OnUnitInactiveSec=300$/m);
});
