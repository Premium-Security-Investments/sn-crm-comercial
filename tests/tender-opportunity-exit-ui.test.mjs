import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const apiClient = readFileSync(new URL('../src/apiClient.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(apiClient, /export\s+async\s+function\s+exitTenderOpportunity\s*\(\s*opportunityId:\s*string\s*,\s*destination:\s*['"]radar['"]\s*\|\s*['"]seguimiento['"]\s*,\s*reason\s*=\s*['"]{2}\s*\)/, 'Debe exportar el cliente tipado de salida.');
const clientStart = apiClient.indexOf('export async function exitTenderOpportunity');
const clientEnd = apiClient.indexOf('\n}', clientStart);
const clientFn = apiClient.slice(clientStart, clientEnd);
assert.match(clientFn, /api\s*\(\s*['"]\/api\/tender-opportunity-exit['"]/, 'Debe usar la ruta nueva.');
assert.match(clientFn, /method\s*:\s*['"]POST['"]/, 'Debe usar POST.');
assert.match(clientFn, /JSON\.stringify\s*\(\s*\{\s*opportunity_id:\s*opportunityId\s*,\s*destination\s*,\s*reason\s*}\s*\)/, 'Debe enviar oportunidad, destino y razón.');

assert.match(app, /import\s+\{\s*api\s*,\s*exitTenderOpportunity\s*,\s*setApiAccessToken\s*}\s+from\s+['"]\.\/apiClient['"]/, 'La UI debe usar el cliente compartido.');
assert.doesNotMatch(app, /\/api\/tender-opportunity-discard/, 'La UI no debe usar la ruta ambigua heredada.');
assert.match(app, />Sacar de oportunidad<\//, 'Debe conservar la salida explícita Sacar de oportunidad.');
assert.match(app, />Pasar a Seguimiento<\//, 'Debe ofrecer Pasar a Seguimiento.');
assert.match(app, /exitTender\(['"]radar['"]\)/, 'Radar debe enviar el destino radar.');
assert.match(app, /exitTender\(['"]seguimiento['"]\)/, 'Seguimiento debe enviar el destino seguimiento.');
assert.match(app, /window\.confirm\(destination === ['"]radar['"][\s\S]*?volverá al Radar[\s\S]*?quedará en Seguimiento/, 'Las confirmaciones deben explicar consecuencias distintas.');
assert.match(app, /await exitTenderOpportunity\(o\.id, destination, reason\)/, 'La UI debe esperar la transición atómica.');
const handlerStart = app.indexOf("const exitTender = async");
const handlerEnd = app.indexOf('return <section', handlerStart);
const handler = app.slice(handlerStart, handlerEnd);
assert.match(handler, /try\s*{\s*await exitTenderOpportunity\(o\.id, destination, reason\);\s*} catch\s*\(err\)\s*{[\s\S]*?setExitFeedback[\s\S]*?return;/, 'Solo un error de mutación debe presentarse como fallo y debe detener el flujo.');
assert.match(handler, /await refresh\(\)\.catch\(\(\) => undefined\)/, 'Un fallo de refresco posterior no debe convertir una transición confirmada en fallo reintentable.');
assert.match(handler, /destination === ['"]seguimiento['"]\s*\?\s*['"]#\/tenders\?view=seguimiento['"]\s*:\s*['"]#\/tenders\?view=radar['"]/, 'La navegación posterior debe corresponder al destino.');
assert.match(app, /disabled=\{Boolean\(exitingTender\)}/, 'Las acciones deben bloquear doble envío.');

console.log('tender opportunity exit UI contract checks passed');
