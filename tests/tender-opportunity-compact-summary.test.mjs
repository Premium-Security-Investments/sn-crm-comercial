import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const tenderBranch = main.match(/\{o\.service_type_code === 'licitacion_publica' \? <>[\s\S]*?<\/\> : <section className="opportunity-insight-grid opportunity-priority-grid"/)?.[0] || '';
const followUp = main.match(/function PublicTenderFollowUp[\s\S]*?\n}\n/)?.[0] || '';

assert.match(tenderBranch, /Panel title="Resumen de la oportunidad"/, 'La oportunidad debe consolidar sus datos principales en un único resumen.');
for (const duplicatedTitle of ['Proceso oficial', 'Cronograma y cuantía', 'Expediente y análisis']) {
  assert.doesNotMatch(tenderBranch, new RegExp(`Panel title="${duplicatedTitle}"`), `${duplicatedTitle} no debe conservar una tarjeta independiente.`);
}
assert.match(tenderBranch, /tender-opportunity-summary-grid/, 'El resumen debe usar una cuadrícula compacta específica.');
assert.doesNotMatch(tenderBranch, /tender-opportunity-technical|label="Snapshot"|label="Productor"|label="Estado técnico"/, 'Snapshot, productor y estado técnico deben eliminarse de la vista operativa.');
assert.match(tenderBranch, /Sector/, 'Sector debe integrarse al resumen principal.');
assert.match(tenderBranch, /Ciudad/, 'Ciudad debe integrarse al resumen principal.');
assert.doesNotMatch(followUp, /Panel title="Datos del proceso"/, 'Seguimiento no debe repetir Datos del proceso.');
assert.match(styles, /\.tender-opportunity-summary-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(/, 'El resumen debe ser compacto y responsive.');
assert.doesNotMatch(styles, /\.tender-opportunity-technical/, 'No deben quedar estilos huérfanos del bloque técnico eliminado.');

console.log('tender compact opportunity summary checks passed');
