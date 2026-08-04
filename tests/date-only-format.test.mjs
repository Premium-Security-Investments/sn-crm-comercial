import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: [new URL('../src/dateOnly.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const dateOnlyUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { parseDateOnly, formatDateOnly } = await import(dateOnlyUrl);

// Regression: the production bug being fixed. main.tsx's current fmtDate/VigiaCommercial's
// displayDate feed a bare "YYYY-MM-DD" Postgres date string into `new Date(value)`, which
// JS parses as UTC midnight. Formatting that with an Intl formatter that has no explicit
// timeZone falls back to the host's local zone, rolling the calendar date back one day in
// any zone behind UTC (e.g. America/Bogota, UTC-5). This is exactly what was observed:
// stored expected_close_date "2026-08-06" rendered as 05/08 instead of 06/08.
function currentBuggyFormat(value) {
  const buggyFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
  return buggyFormatter.format(new Date(value));
}

const buggyUnderBogota = execFileSync(process.execPath, ['-e', `
  const f = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
  process.stdout.write(f.format(new Date('2026-08-06')));
`], { env: { ...process.env, TZ: 'America/Bogota' }, encoding: 'utf8' });
assert.equal(buggyUnderBogota, '5/08/2026', 'Characterizes the known bug: naive new Date(value) formatting rolls the date back one day in Bogotá.');

// The new date-only formatter must preserve the stored calendar date regardless of the
// host timezone, because a Postgres `date` column has no time-of-day / zone component.
assert.equal(formatDateOnly('2026-08-06'), '6/08/2026');

for (const tz of ['America/Bogota', 'UTC', 'Pacific/Kiritimati', 'Pacific/Midway']) {
  const output = execFileSync(process.execPath, ['-e', `
    import('${dateOnlyUrl}').then(m => process.stdout.write(m.formatDateOnly('2026-08-06')));
  `, '--input-type=module'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(output, '6/08/2026', `formatDateOnly must render the same calendar date under TZ=${tz}`);
}

// Edit-form parity: the working <input type="date"> pattern round-trips the raw
// "YYYY-MM-DD" string verbatim. parseDateOnly must agree with that on the calendar parts.
assert.deepEqual(parseDateOnly('2026-08-06'), { year: 2026, month: 8, day: 6 });
assert.deepEqual(parseDateOnly('2026-08-06T00:00:00.000Z'), { year: 2026, month: 8, day: 6 }, 'Also accepts a date-only value with an incidental time/zone suffix.');

// Invalid-input safety: must not throw, must not produce "Invalid Date"/NaN output.
for (const invalid of [null, undefined, '', 'not-a-date', '2026-02-30', '2026-13-01', '2026-08', 42, {}]) {
  assert.doesNotThrow(() => formatDateOnly(invalid), `formatDateOnly must not throw for ${JSON.stringify(invalid)}`);
  assert.equal(formatDateOnly(invalid), '—', `formatDateOnly must fall back safely for ${JSON.stringify(invalid)}`);
  assert.doesNotThrow(() => parseDateOnly(invalid), `parseDateOnly must not throw for ${JSON.stringify(invalid)}`);
  assert.equal(parseDateOnly(invalid), null, `parseDateOnly must return null for ${JSON.stringify(invalid)}`);
}

assert.equal(formatDateOnly(null, 'Sin datos'), 'Sin datos', 'Caller-supplied fallback text must be honored.');

console.log('date-only parser/formatter preserves calendar dates across timezones and is documented against the Bogotá regression');
