import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes("return { page: 'dashboard' };"), 'default route / should render dashboard gerencial');
assert.ok(!main.includes("['#/','Inicio']"), 'Inicio should be removed from sidebar nav');

const navLine = main.split('\n').find(line => line.includes('const items = [['));
assert.ok(navLine, 'Nav items should be declared inline');
assert.ok(main.includes("['#/tenders','Licitaciones']"), 'authorized users should see Licitaciones after Oportunidades');
assert.ok(main.includes('canViewTenders(currentProfile)'), 'Licitaciones tab should be gated by role/person.');
const expectedOrder = ["['#/dashboard','Dashboard gerencial']", "['#/alerts','Alertas comerciales']", "['#/opportunities','Oportunidades']", "['#/tenders','Licitaciones']", "['#/goals','Metas y cumplimiento']", "['#/new','Crear oportunidad']", "['#/vig-ia','Vig-IA']"];
let lastIndex = -1;
for (const marker of expectedOrder) {
  const idx = main.indexOf(marker);
  assert.ok(idx > lastIndex, `${marker} should appear after previous nav marker`);
  lastIndex = idx;
}

console.log('navigation dashboard default static checks passed');
