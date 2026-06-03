import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes('CRM comercial · Seguridad Nacional'), 'main.tsx should keep concise CRM topbar context');
assert.ok(!main.includes('seguridadnacional.com.co'), 'main.tsx should not show seguridadnacional.com.co in visible page headers');

console.log('topbar-copy static checks passed');
