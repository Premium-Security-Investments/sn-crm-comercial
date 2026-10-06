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
// Resumen compacto (2026-10): la entidad, la cuantía y el responsable ya encabezan la ficha, así que el resumen
// sólo agrega el cierre oficial con su cuenta regresiva y una línea con los hechos del proceso.
assert.match(tenderBranch, /tender-summary-compact/, 'El resumen debe usar el bloque compacto de cierre y hechos.');
assert.match(tenderBranch, /tender-summary-close[\s\S]*Cierre oficial[\s\S]*tenderCloseCountdown\(o\.expected_close_date\)/, 'El cierre oficial debe mostrar los días que faltan.');
assert.doesNotMatch(tenderBranch, /tender-opportunity-technical|label="Snapshot"|label="Productor"|label="Estado técnico"/, 'Snapshot, productor y estado técnico deben eliminarse de la vista operativa.');
assert.match(tenderBranch, /o\.economic_sector/, 'Sector debe integrarse al resumen principal.');
assert.match(tenderBranch, /o\.quote_city \|\| 'Ciudad por confirmar'/, 'Ciudad debe integrarse al resumen principal.');
assert.doesNotMatch(followUp, /Panel title="Datos del proceso"/, 'Seguimiento no debe repetir Datos del proceso.');
assert.match(styles, /\.tender-summary-compact \{[^}]*flex-wrap: wrap/, 'El resumen debe ser compacto y responsive.');
assert.doesNotMatch(styles, /\.tender-opportunity-technical/, 'No deben quedar estilos huérfanos del bloque técnico eliminado.');

console.log('tender compact opportunity summary checks passed');
