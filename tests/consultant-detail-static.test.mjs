import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(source, /page: 'consultant'/, 'Route debe incluir la página consultant para detalle por consultor');
assert.match(source, /#\/consultant\//, 'Dashboard gerencial debe navegar a #/consultant/<id> desde cada consultor');
assert.match(source, /function ConsultantDetail/, 'Debe existir una vista ConsultantDetail');
assert.match(source, /Detalle por etapa/, 'La vista del consultor debe mostrar detalle por etapa');
assert.match(source, /Oportunidades del consultor/, 'La vista del consultor debe mostrar tabla de oportunidades');

console.log('consultant-detail static checks passed');
