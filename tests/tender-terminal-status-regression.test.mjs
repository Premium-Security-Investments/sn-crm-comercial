import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = new URL('../tender-source-status.js', import.meta.url);
assert.ok(existsSync(modulePath), 'RED: falta el módulo compartido de estado terminal de licitaciones.');
const lifecycle = await import(`${pathToFileURL(modulePath.pathname)}?terminal-status-regression=${Date.now()}`);

for (const value of ['Cancelado', 'Cancelada', 'Revocado', 'Revocada', 'Declarado desierto', 'Desierta', 'Request Canceled', 'Request Cancelled']) {
  assert.equal(lifecycle.isTenderTerminalStatus(value), true, `${value} debe ser terminal.`);
}
for (const value of ['Presentación de oferta', 'Presentación de observaciones', 'Publicado', 'Suspendido']) {
  assert.equal(lifecycle.isTenderTerminalStatus(value), false, `${value} no debe clasificarse automáticamente como terminal.`);
}
assert.equal(lifecycle.officialTenderStatus({ fase: 'Presentación de observaciones', estado_del_procedimiento: 'Cancelado' }, 'SECOP II'), 'Cancelado', 'SECOP II debe priorizar estado oficial sobre fase.');
assert.equal(lifecycle.officialTenderStatus({ estado_del_proceso: 'Celebrado' }, 'SECOP I'), 'Celebrado');
assert.equal(lifecycle.isTenderTrackableStatus({ status: 'Presentación de observaciones', raw: { estado_del_procedimiento: 'Cancelado' } }), false);
assert.equal(lifecycle.isTenderTrackableStatus({ status: 'Presentación de oferta', raw: { estado_del_procedimiento: 'Publicado' } }), true);

for (const relative of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /persistenceTenders/, `${relative} debe separar filas persistibles de sugerencias visibles.`);
  assert.match(source, /revalidateTenderOfficialStatus/, `${relative} debe revalidar el estado oficial antes de convertir.`);
  assert.match(source, /if \(!isTenderTrackableStatus\(officialState\)\)/, `${relative} debe bloquear estado terminal confirmado.`);
  assert.match(source, /status: officialTenderStatus\(row, source\)/, `${relative} debe normalizar el estado oficial.`);
}

const migrationPath = new URL('../supabase/migrations/031_tender_terminal_status_guard.sql', import.meta.url);
assert.ok(existsSync(migrationPath), 'Debe existir migración forward-only para el guard de conversión RPC.');
const migration = readFileSync(migrationPath, 'utf8');
assert.match(migration, /psi_is_tender_terminal_status/i);
assert.match(migration, /No se puede convertir una licitación cancelada, revocada o declarada desierta/i);
assert.match(migration, /pg_get_functiondef/i, 'La migración debe preservar la definición vigente del RPC.');
assert.match(migration, /psi_profile_has_tender_custody/i, 'La migración debe abortar si falta el guard de custodia vigente.');

console.log('terminal tender lifecycle regression passed');
