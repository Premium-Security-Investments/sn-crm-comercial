import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const match = main.match(/function parseRoute\(\): Route \{([\s\S]*?)\n\}/);
assert.ok(match, 'parseRoute debe existir');

const parseRouteFor = new Function('window', match[1]);

assert.deepEqual(
  parseRouteFor({ location: { hash: '' } }),
  { page: 'dashboard' },
  'La raíz sin hash debe abrir el dashboard en vez de una URL inválida.',
);
assert.deepEqual(
  parseRouteFor({ location: { hash: '#/ruta-desconocida' } }),
  { page: 'invalid' },
  'Los hashes desconocidos deben seguir fallando de forma cerrada.',
);
assert.deepEqual(
  parseRouteFor({ location: { hash: '#/detail' } }),
  { page: 'invalid' },
  'Las rutas de detalle incompletas deben seguir siendo inválidas.',
);

console.log('navigation root route OK');
