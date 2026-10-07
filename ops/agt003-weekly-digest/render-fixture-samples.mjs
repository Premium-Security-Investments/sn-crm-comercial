#!/usr/bin/env node
// Renderiza los correos del fixture ficticio (tests/fixtures) a archivos .html/.txt para revisión visual.
// Sin base de datos ni red. Uso: node ops/agt003-weekly-digest/render-fixture-samples.mjs [directorio]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildWeeklyDigest } from '../../src/vigia/weekly-digest.js';
import { weeklyDigestFixture } from '../../tests/fixtures/agt003-weekly-digest-fixture.mjs';

const dir = resolve(process.argv[2] || 'tmp-samples');
mkdirSync(dir, { recursive: true });
for (const [mode, sample] of [['live', null], ['preview', 1]]) {
  const outbox = buildWeeklyDigest({ ...weeklyDigestFixture(), mode, sample });
  outbox.messages.forEach((m, i) => {
    const name = `${mode}-${String(i + 1).padStart(2, '0')}-${m.kind}`;
    writeFileSync(join(dir, `${name}.html`), m.html);
    writeFileSync(join(dir, `${name}.txt`), `Para: ${m.to.join(', ')}\nCopia: ${m.cc.join(', ') || '(ninguna)'}\nAsunto: ${m.subject}\n\n${m.text}`);
  });
  writeFileSync(join(dir, `outbox-${mode}.json`), `${JSON.stringify(outbox, null, 2)}\n`);
}
console.log(dir);
