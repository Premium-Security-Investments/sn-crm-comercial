import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const radarUtilsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { isTenderExpired, tenderDeadlineBucket } = await import(radarUtilsUrl);
const tenderWithDeadline = deadline => ({ deadline });

const bogotaNoon = new Date('2026-07-22T17:00:00.000Z'); // 12:00 Bogotá
assert.equal(isTenderExpired('2026-07-21', bogotaNoon), true);
assert.equal(isTenderExpired('2026-07-22', bogotaNoon), false);
assert.equal(isTenderExpired('2026-07-23', bogotaNoon), false);
assert.equal(isTenderExpired('2026-07-21T23:59:59.000Z', bogotaNoon), true, 'El contrato actual acepta deadlines ISO con sufijo.');
assert.equal(isTenderExpired(null, bogotaNoon), false);
assert.equal(isTenderExpired(undefined, bogotaNoon), false);
assert.equal(isTenderExpired('no-es-fecha', bogotaNoon), false);
assert.equal(isTenderExpired('2026-02-30', bogotaNoon), false);
for (const invalidIso of [
  '2026-07-21T99:99Z',
  '2026-07-21T12:60Z',
  '2026-07-21T12:34:60Z',
  '2026-07-21T12:34:56+25:00',
  '2026-02-30T12:00:00Z',
]) {
  assert.equal(isTenderExpired(invalidIso, bogotaNoon), false, `${invalidIso} debe rechazarse semánticamente.`);
}

const justBeforeBogotaMidnight = new Date('2026-07-22T04:59:59.000Z'); // 23:59:59 del 21 en Bogotá
const bogotaMidnight = new Date('2026-07-22T05:00:00.000Z'); // 00:00:00 del 22 en Bogotá
assert.equal(isTenderExpired('2026-07-21', justBeforeBogotaMidnight), false, 'Hoy Bogotá no está vencida aunque UTC ya sea 22.');
assert.equal(isTenderExpired('2026-07-21', bogotaMidnight), true, 'La fecha vence al iniciar el día siguiente en Bogotá.');
assert.equal(isTenderExpired('2026-07-22', bogotaMidnight), false, 'La fecha de hoy Bogotá no vence.');

assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-07-21'), justBeforeBogotaMidnight), '0_7', 'La fecha de hoy Bogotá debe estar en 0_7 antes de medianoche.');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-07-21'), bogotaMidnight), 'vencida', 'La fecha del día anterior Bogotá debe estar vencida tras medianoche.');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-07-22'), bogotaMidnight), '0_7', 'Hoy Bogotá no vence.');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-07-29'), bogotaMidnight), '0_7');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-07-30'), bogotaMidnight), '8_15');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-08-06'), bogotaMidnight), '8_15');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-08-07'), bogotaMidnight), '16_30');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-08-21'), bogotaMidnight), '16_30');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-08-22'), bogotaMidnight), '31_plus');
assert.equal(tenderDeadlineBucket(tenderWithDeadline('2026-07-21T99:99Z'), bogotaMidnight), 'sin_fecha', 'Los deadlines inválidos no deben entrar en vencidas.');

assert.match(radar, /isTenderExpired/, 'Radar debe consultar el helper de fecha Bogotá.');
assert.match(radar, /Vencida · valide adendas o nueva fecha en la fuente oficial/, 'El copy de advertencia debe ser exacto.');
assert.match(radar, /tender-expired-warning/, 'La advertencia requiere una clase visual dedicada.');
assert.match(styles, /\.tender-expired-warning\{[^}]*border[^}]*background[^}]*color[^}]*/s, 'La advertencia debe ser visible, contrastada y accesible.');
assert.match(radar, /Pasar a seguimiento/, 'La acción de seguimiento sigue disponible.');
assert.match(radar, /Convertir en oportunidad/, 'La acción de conversión sigue disponible.');
assert.doesNotMatch(radar, /disabled=\{[^}]*isTenderExpired[^}]*\}/, 'La advertencia no puede deshabilitar acciones.');

console.log('Tender expired warning and deadline buckets use Bogotá calendar dates without blocking actions');
