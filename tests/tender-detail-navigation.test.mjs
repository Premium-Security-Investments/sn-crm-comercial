import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const componentUrl = new URL('../src/tenders/components/TenderDetailNavigation.tsx', import.meta.url);
let component = '';
try { component = readFileSync(componentUrl, 'utf8'); } catch {}
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

for (const id of ['tender-summary', 'tender-document-review', 'tender-analysis', 'tender-decision', 'tender-preparation', 'tender-follow-up']) {
  assert.match(`${component}\n${main}`, new RegExp(`id=[\\"'{]*${id}|['\\"]${id}['\\"]`), `falta ancla ${id}`);
  assert.match(component, new RegExp(id), `la navegación debe apuntar a ${id}`);
}
for (const label of ['Resumen', 'Revisión documental', 'Análisis / preanálisis', 'GO / NO GO', 'Preparación', 'Seguimiento']) assert.match(component, new RegExp(label));
assert.match(component, /Volver a Oportunidades/);
assert.match(component, /Abrir fuente oficial/);
assert.match(component, /aria-current="page"/);
assert.match(component, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
assert.match(component, /sourceUrl/);
assert.match(component, /observations/);
assert.match(component, /Link fuente:/, 'el URL histórico sólo debe ser fallback explícito');
assert.match(main, /<TenderDetailNavigation/);
assert.match(server, /from\('psi_public_tenders'\)\.select\('url'\)\.eq\('converted_opportunity_id', id\)/);
assert.match(server, /opportunity\.source_url = tenderSource\?\.url \|\| getTenderSourceUrlFromOpportunity\(opportunity\)/);
assert.match(styles, /\.tender-detail-progress/);
assert.match(styles, /overflow-x:\s*auto/);
assert.match(styles, /scroll-margin-top/);

console.log('tender detail navigation shell passed');
