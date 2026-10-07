import fs from 'node:fs';
import assert from 'node:assert/strict';

// Las seis secciones del tablero gerencial se reemplazaron por tres preguntas (decisión del dueño, 2026-10-07).
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

for (const retired of ['1. Resumen ejecutivo', '2. Presupuesto y ventas 2026', '3. Cumplimiento por comercial', '4. Pipeline y oportunidades prioritarias', '5. Gestión comercial que requiere atención', '6. Tendencia y salud comercial', 'dashboard-v2-six-components']) {
  assert.ok(!main.includes(retired), `sección retirada: ${retired}`);
}
const blocks = main.match(/className="v2-component-block dashboard-question"/g) || [];
assert.equal(blocks.length, 3, 'el Dashboard comercial tiene exactamente tres preguntas');
assert.ok(!main.includes('Secciones traídas del Dashboard 1'), 'sin lenguaje interno de traspaso');

console.log('dashboard three-question static checks passed');
