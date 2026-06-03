import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes("return { page: 'dashboard' };"), 'default route / should render dashboard gerencial');
assert.ok(!main.includes("['#/','Inicio']"), 'Inicio should be removed from sidebar nav');

const navLine = main.split('\n').find(line => line.includes('const items = [['));
assert.ok(navLine, 'Nav items should be declared inline');
const labels = [...navLine.matchAll(/'([^']+)'\]/g)].map(match => match[1]);
assert.deepEqual(labels, [
  'Dashboard gerencial',
  'Alertas comerciales',
  'Oportunidades',
  'Metas y cumplimiento',
  'Crear oportunidad',
  'Centinel',
], 'sidebar nav order should match approved order');

console.log('navigation dashboard default static checks passed');
