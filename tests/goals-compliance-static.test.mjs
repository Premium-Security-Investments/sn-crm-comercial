import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(src.includes("'goals'"), 'Route debe incluir goals para Metas Comerciales y Cumplimiento.');
assert(src.includes('GoalsCompliance'), 'Debe existir componente GoalsCompliance.');
assert(src.includes('goalStatusTone'), 'Debe existir función de semáforo goalStatusTone.');
assert(src.includes('Trimestre acumulado'), 'La UI debe mostrar Trimestre acumulado, no trimestre futuro completo.');
assert(src.includes('Semestre acumulado'), 'La UI debe mostrar Semestre acumulado.');
assert(src.includes('Año acumulado'), 'La UI debe mostrar Año acumulado.');
assert(src.includes('Presupuesto aprobado'), 'La tabla debe incluir el indicador financiero de presupuesto aprobado.');
assert(src.includes('Prospectos nuevos'), 'La tabla debe incluir prospectos nuevos.');
assert(src.includes('Propuestas / cotizaciones'), 'La tabla debe incluir propuestas/cotizaciones.');
assert(src.includes('Filtros de consulta'), 'Metas debe separar filtros de consulta del panel de carga.');
assert(src.includes('Cargar o editar metas'), 'Metas debe tener un panel administrativo separado para cargar/editar metas.');
assert(src.includes('Guardar metas'), 'El botón debe guardar metas, no solo presupuesto.');
assert(src.includes('viewOwnerId'), 'La consulta debe usar estado independiente para asesor visualizado.');
assert(src.includes('editOwnerId'), 'La carga de metas debe usar estado independiente para asesor editado.');
assert(src.includes('Todos los asesores'), 'Gerencia debe poder consultar metas agregadas de todos los asesores.');
assert(!src.includes('Lectura de negocio'), 'Metas no debe mostrar panel explicativo Lectura de negocio.');
assert(!src.includes('Reglas comerciales por unidad'), 'Metas no debe mostrar Reglas comerciales por unidad.');
assert(src.includes('/api/goals'), 'La UI debe consumir endpoint /api/goals.');
assert(css.includes('.goals-dashboard .compliance-table table'), 'Metas debe tener tabla de cumplimiento ajustada al tema oscuro.');
assert(css.includes('.goals-dashboard .compliance-cell.danger'), 'Metas debe mostrar semáforo rojo con contraste en dark mode.');
assert(css.includes('.goals-dashboard .goals-form'), 'El formulario de metas debe estar contenido en panel oscuro legible.');
assert(server.includes("app.get('/api/goals'"), 'Servidor local debe exponer GET /api/goals.');
assert(server.includes("app.put('/api/goals'"), 'Servidor local debe exponer PUT /api/goals para upsert.');
assert(api.includes("app.get('/api/goals'"), 'Serverless debe exponer GET /api/goals.');
assert(api.includes("app.put('/api/goals'"), 'Serverless debe exponer PUT /api/goals para upsert.');

console.log('goals-compliance static checks passed');
