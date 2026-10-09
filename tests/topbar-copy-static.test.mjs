import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes('<p>SIIO · {areaFor(route)}</p>'), 'el subtítulo de cada pantalla es SIIO · <área del menú>');
assert.ok(!main.includes('seguridadnacional.com.co'), 'main.tsx should not show seguridadnacional.com.co in visible page headers');

console.log('topbar-copy static checks passed');
