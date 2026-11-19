import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes('<CabeceraMarca area={areaFor(route)}'), 'la cabecera azul dice el área del menú en que se está');
assert.ok(main.includes('<div className="sn-titulo-pagina"><p>{fechaDeHoyBogota()}</p>'), 'sobre el título va la fecha de hoy en Bogotá, como en SecurityOps');
assert.ok(!main.includes('seguridadnacional.com.co'), 'main.tsx should not show seguridadnacional.com.co in visible page headers');

console.log('topbar-copy static checks passed');
