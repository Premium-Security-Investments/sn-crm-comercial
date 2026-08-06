import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const api = read('src/tenders/api.ts');
const main = read('src/main.tsx');
const panel = read('src/tenders/components/TenderGoNoGoDecisionPanel.tsx');
const server = read('server/index.js');
const vercel = read('api/[...path].js');
const migrationPath = new URL('../supabase/migrations/039_tender_business_timeline.sql', import.meta.url);

assert.match(api, /loadTrackingEvents\([\s\S]*?scope\??:\s*'business'\s*\|\s*'technical'/, 'El loader debe aceptar scope tipado business|technical.');
assert.match(api, /query\.set\('scope',\s*scope\)/, 'El loader debe enviar el scope al backend.');

for (const [label, source] of [['server', server], ['vercel', vercel]]) {
  assert.match(source, /TENDER_BUSINESS_EVENT_TYPES/, `${label}: debe declarar eventos de negocio explícitos.`);
  assert.match(source, /TENDER_TECHNICAL_EVENT_TYPES/, `${label}: debe declarar eventos técnicos explícitos.`);
  assert.match(source, /req\.query\.scope/, `${label}: debe leer scope.`);
  assert.match(source, /\.in\('event_type',\s*eventTypes\)/, `${label}: debe filtrar en servidor antes de paginar.`);
}
assert.ok(buffersAreEqual(Buffer.from(server), Buffer.from(vercel)), 'Los backends deben permanecer byte-idénticos.');

const followUpStart = main.indexOf('function PublicTenderFollowUp(');
const followUpEnd = main.indexOf('\nfunction OpportunityForm(', followUpStart);
const followUp = main.slice(followUpStart, followUpEnd);
assert.match(followUp, /loadTrackingEvents\(api,\s*opportunity\.id,\s*cursor,\s*'business'\)/, 'Historial del proceso debe cargar sólo negocio.');
assert.match(followUp, /loadTrackingEvents\(api,\s*opportunity\.id,\s*null,\s*'technical'\)/, 'La auditoría debe cargar telemetría por separado.');
assert.match(followUp, /<Panel title="Historial del proceso">/, 'Debe conservar el historial comercial.');
assert.match(followUp, /<summary>Auditoría técnica de \{VIGIA_VISIBLE_NAMES\.tenders\}<\/summary>/, 'La telemetría debe vivir en un detalle técnico plegable y atribuirse a Vig-IA Licitaciones.');
assert.match(followUp, /decisions\.length\s*&&\s*\['go_decided',\s*'no_go_decided'\]\.includes\(event\.event_type\)/, 'La decisión canónica debe evitar GO/NO GO duplicados desde tracking.');
assert.match(followUp, /offerHistory\.length\s*&&\s*event\.event_type\s*===\s*'offer_preparation_started'/, 'El cambio de estado canónico debe evitar duplicar el inicio de preparación.');
for (const label of ['Procesamiento en cola', 'Importación documental fallida', 'Análisis completado']) {
  assert.match(main, new RegExp(label), `La auditoría debe traducir ${label}.`);
}

assert.match(panel, /Siguiente paso/, 'La decisión vigente debe comunicar una próxima acción.');
assert.match(panel, /Preparación iniciada/, 'GO debe mostrar la transición operativa real.');
assert.match(panel, /getElementById\('tender-preparation'\)[\s\S]*?scrollIntoView/, 'GO debe ofrecer acceso directo al expediente sin romper el hash router.');
assert.match(panel, /<details className="tender-go-no-go-history"/, 'El historial inmutable debe quedar secundario y plegable.');
assert.match(panel, /<details className="tender-go-no-go-warnings"/, 'Las alertas deben quedar compactas y plegables.');
assert.doesNotMatch(panel, /<dt>Referencia<\/dt>/, 'El modal no debe repetir la referencia técnica.');
assert.doesNotMatch(panel, /<dt>Recomendación del sistema<\/dt>/, 'El modal no debe repetir la recomendación visible detrás.');

assert.equal(existsSync(migrationPath), true, 'Debe existir migración 039 para hitos GO/NO GO en el timeline.');
const migration = existsSync(migrationPath) ? read('supabase/migrations/039_tender_business_timeline.sql') : '';
for (const eventType of ['go_decided', 'no_go_decided', 'offer_preparation_started']) {
  assert.match(migration, new RegExp(eventType), `La migración debe registrar ${eventType}.`);
}
assert.match(migration, /psi_append_tender_tracking_event/, 'Los hitos deben usar el RPC append-only existente.');
assert.doesNotMatch(migration, /stage_code\s*=/, 'La decisión no debe mover la etapa comercial a ciegas.');

transformSync(main, { loader: 'tsx', format: 'esm', target: 'es2020' });
transformSync(panel, { loader: 'tsx', format: 'esm', target: 'es2020' });
console.log('tender business timeline and GO transition contract passed');
