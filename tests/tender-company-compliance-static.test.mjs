import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert(src.includes('TenderCompanyCompliancePanel'), 'Licitaciones debe incluir una sección de perfil/habilitación de empresa.');
assert(src.includes('Perfil de habilitación de la empresa'), 'La sección debe tener título ejecutivo claro.');
assert(src.includes('RUP'), 'La matriz debe contemplar Registro Único de Proponentes.');
assert(src.includes('capacidad jurídica'), 'La matriz debe contemplar capacidad jurídica.');
assert(src.includes('capacidad financiera'), 'La matriz debe contemplar capacidad financiera.');
assert(src.includes('capacidad organizacional'), 'La matriz debe contemplar capacidad organizacional.');
assert(src.includes('inhabilidades e incompatibilidades'), 'La matriz debe contemplar inhabilidades e incompatibilidades.');
assert(src.includes('Superintendencia de Vigilancia'), 'La matriz debe contemplar habilitación sectorial de vigilancia privada.');
assert(src.includes('Ley 80 de 1993'), 'La sección debe listar Ley 80 de 1993 como marco normativo base.');
assert(src.includes('Ley 1150 de 2007'), 'La sección debe listar Ley 1150 de 2007.');
assert(src.includes('Decreto 1082 de 2015'), 'La sección debe listar Decreto 1082 de 2015.');
assert(src.includes('Ley 1882 de 2018'), 'La sección debe listar Ley 1882 de 2018.');
assert(src.includes('Ley 2195 de 2022'), 'La sección debe listar Ley 2195 de 2022 para transparencia/anticorrupción.');
assert(src.indexOf('<TenderCompanyCompliancePanel />') > src.indexOf('<section className="tender-quick-views-panel"'), 'La sección debe aparecer dentro de Licitaciones antes de la bandeja de resultados.');
assert(css.includes('.company-compliance-panel'), 'Debe existir estilo para el panel de habilitación.');
assert(css.includes('.compliance-matrix'), 'Debe existir estilo para la matriz de cumplimiento.');

console.log('tender-company-compliance-static ok');
