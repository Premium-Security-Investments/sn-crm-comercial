import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
const trackingView = readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');

assert.match(api, /export async function loadTrackingEvents\(request: TenderRequest, tenderId: string, cursor\??:/, 'loadTrackingEvents debe aceptar cursor');
assert.match(types, /TenderTrackingEventsPage = \{ events: TenderTrackingEvent\[\]; next_cursor: string \| null \}/, 'loadTrackingEvents debe exponer la página y el siguiente cursor');
assert.match(api, /export async function postActuation\(/, 'api.ts debe exportar postActuation');
assert.match(api, /'\/api\/tender-actuation'/, 'postActuation debe usar el endpoint público tipado');
assert.match(trackingView, /loadedPage\.events/, 'TenderTrackingView debe consumir la respuesta paginada real');

assert.match(main, /o\.service_type_code === 'licitacion_publica' \? <PublicTenderFollowUp/, 'Seguimiento debe tener rama pública especializada');
assert.match(main, /<Panel title="Datos del proceso">/, 'Debe mostrar Datos del proceso');
assert.match(main, /<Panel title="Registrar actuación o novedad">/, 'Debe mostrar el formulario público');
assert.match(main, /<Panel title="Historial del proceso">/, 'Debe mostrar el historial unificado');
assert.match(main, /loadTrackingEvents\(api, opportunity\.id, cursor\)/, 'El historial público debe cargar páginas por cursor');
assert.match(main, /postActuation\(api, \{ tender_id: opportunity\.id, type, note \}\)/, 'La actuación debe usar el endpoint tipado');
assert.match(main, /Registrado por: \{currentProfile\.full_name\}/, 'El actor debe derivarse del perfil actual');

const publicStart = main.indexOf('function PublicTenderFollowUp(');
const publicEnd = main.indexOf('\nfunction OpportunityForm(', publicStart);
assert.ok(publicStart >= 0 && publicEnd > publicStart, 'Debe existir PublicTenderFollowUp como componente aislado');
const publicBlock = main.slice(publicStart, publicEnd);
assert.doesNotMatch(publicBlock, /interactionTypes\.map/, 'La rama pública no debe usar tipos comerciales');
assert.doesNotMatch(publicBlock, /profiles\.map|created_by.*Select|Quién registra/, 'El actor no puede ser seleccionable');
assert.doesNotMatch(publicBlock, /label="Sede"|label="Observaciones"/, 'Datos del proceso no debe exponer mapeos privados incorrectos');

transformSync(main, { loader: 'tsx', format: 'esm', target: 'es2020' });
console.log('tender follow-up public contract passed');
