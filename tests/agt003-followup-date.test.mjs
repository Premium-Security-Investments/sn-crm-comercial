import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const start = main.indexOf('function FollowUpForm(');
const end = main.indexOf('\nconst publicActuationOptions', start);
assert.notEqual(start, -1, 'FollowUpForm must exist');
assert.notEqual(end, -1, 'FollowUpForm boundary must exist');
const followUp = main.slice(start, end);

assert.equal((followUp.match(/type="date"/g) || []).length, 1, 'only Fecha del seguimiento uses a date control');
assert.match(followUp, /Fecha del seguimiento<input type="date" value=\{form\.occurred_at\}/);
assert.equal((followUp.match(/type="datetime-local"/g) || []).length, 1, 'Próxima gestión keeps its datetime-local control');
assert.match(followUp, /Próxima gestión \(opcional\)<input type="datetime-local" value=\{form\.next_action_at\}/);
assert.match(followUp, /occurred_at: bogotaToday\(\)/, 'the initial follow-up day must come from America/Bogota');
assert.match(followUp, /occurred_at: followUpDateToIso\(form\.occurred_at\)/, 'submission must use the deterministic noon conversion');
assert.doesNotMatch(followUp, /new Date\(form\.occurred_at\)|new Date\(['"]YYYY-MM-DD/, 'the day must never be parsed as UTC midnight');

let dateSource = '';
try {
  dateSource = readFileSync(new URL('../src/followUpDate.ts', import.meta.url), 'utf8');
} catch {
  assert.fail('src/followUpDate.ts must provide the tested Bogotá date behavior');
}
const { code } = await transform(dateSource, { loader: 'ts', format: 'esm', target: 'es2020' });
const dateModule = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

assert.equal(dateModule.bogotaToday(new Date('2026-08-26T03:30:00.000Z')), '2026-08-25', 'initial day follows Bogotá across the UTC date boundary');
assert.equal(dateModule.followUpDateToIso('2026-08-26'), '2026-08-26T17:00:00.000Z', 'selected day is persisted as noon at -05:00');
assert.equal(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(dateModule.followUpDateToIso('2026-08-26'))),
  '2026-08-26',
  'the persisted timestamp presents as the exact selected commercial day in Bogotá',
);

console.log('AGT-003 follow-up date control and Bogotá day preservation checks passed');
