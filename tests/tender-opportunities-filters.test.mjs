import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const opportunitiesView = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
assert.match(opportunitiesView, /requestVersionRef/);
assert.match(opportunitiesView, /requestVersion === requestVersionRef\.current/);

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/viewUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { filterOpportunitySummaries } = await import(utilsUrl);

const rows = [
  { id: 'pending', decision: null, tender_offer_status: 'pendiente_decision' },
  { id: 'pending-decided', decision: 'no_go', tender_offer_status: 'pendiente_decision' },
  { id: 'go-active', decision: 'go', tender_offer_status: 'en_preparacion' },
  { id: 'go-revoked', decision: 'no_go', tender_offer_status: 'en_preparacion' },
  { id: 'go-presented', decision: 'go', tender_offer_status: 'presentada' },
  { id: 'no-go', decision: 'no_go', tender_offer_status: 'cerrada_no_go' },
  { id: 'awarded', decision: 'go', tender_offer_status: 'adjudicada' },
  { id: 'ready', decision: 'go', tender_offer_status: 'lista_para_presentar' },
  { id: 'not-awarded', decision: 'go', tender_offer_status: 'no_adjudicada' },
  { id: 'recommendation-only', recommendation: 'GO', decision: null, tender_offer_status: 'pendiente_decision' },
];

assert.deepEqual(filterOpportunitySummaries(rows, 'all').map(row => row.id), rows.map(row => row.id));
assert.deepEqual(filterOpportunitySummaries(rows, 'pending_decision').map(row => row.id), ['pending', 'recommendation-only']);
assert.deepEqual(filterOpportunitySummaries(rows, 'go_authorized').map(row => row.id), ['go-active', 'go-presented', 'ready']);
assert.deepEqual(filterOpportunitySummaries(rows, 'in_preparation').map(row => row.id), ['go-active', 'go-revoked', 'ready']);
assert.deepEqual(filterOpportunitySummaries(rows, 'submitted').map(row => row.id), ['go-presented']);
assert.deepEqual(filterOpportunitySummaries(rows, 'closed').map(row => row.id), ['no-go', 'awarded', 'not-awarded']);
assert.throws(() => filterOpportunitySummaries(rows, 'invalid'), /filtro/i);

// --- Approved contract: exactly three compact primary filters (Todas / Por decidir / En curso).
// Cerradas stays an internal classification only — classifyOpportunityStage keeps returning it for
// closed records, but it must never again be a user-selectable primary filter. ---
const stageBundle = buildSync({
  entryPoints: [new URL('../src/tenders/opportunityStage.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const stageUrl = `data:text/javascript;base64,${Buffer.from(stageBundle.outputFiles[0].contents).toString('base64')}`;
const { OPPORTUNITY_PRIMARY_FILTER_OPTIONS, classifyOpportunityStage, matchesOpportunityPrimaryFilter, isOpportunityPrimaryFilter, normalizeOpportunityPrimaryFilter } = await import(stageUrl);

assert.deepEqual(OPPORTUNITY_PRIMARY_FILTER_OPTIONS, [
  { value: 'all', label: 'Todas' },
  { value: 'por_decidir', label: 'Por decidir' },
  { value: 'en_curso', label: 'En curso' },
], 'La bandeja debe exponer exactamente tres filtros primarios: Todas, Por decidir, En curso.');
assert.equal(isOpportunityPrimaryFilter('cerradas'), false, 'Cerradas no debe ser un filtro seleccionable por el usuario.');
assert.equal(isOpportunityPrimaryFilter('por_decidir'), true, 'Por decidir sigue siendo vocabulario primario válido (existe en la migración 088 y el backend).');
assert.equal(isOpportunityPrimaryFilter('en_curso'), true, 'En curso sigue siendo vocabulario primario válido (existe en la migración 088 y el backend).');
assert.equal(normalizeOpportunityPrimaryFilter('cerradas'), 'all', 'Un valor ya no seleccionable degrada a Todas, nunca a un predicado cerrado.');
assert.equal(normalizeOpportunityPrimaryFilter('por_decidir'), 'por_decidir', 'Por decidir se conserva tal cual: es vocabulario primario válido, no se traduce.');
assert.equal(normalizeOpportunityPrimaryFilter('en_curso'), 'en_curso', 'En curso se conserva tal cual: es vocabulario primario válido, no se traduce.');

const closedByDecision = { decision: 'no_go', tender_offer_status: 'en_preparacion' };
const closedByStatus = { decision: 'go', tender_offer_status: 'adjudicada' };
const pendingRow = { decision: null, tender_offer_status: 'pendiente_decision' };
const activeRow = { decision: 'go', tender_offer_status: 'en_preparacion' };
for (const closedRow of [closedByDecision, closedByStatus]) {
  assert.equal(classifyOpportunityStage(closedRow), 'cerradas', 'La clasificación interna cerradas se conserva para registros cerrados.');
  assert.equal(matchesOpportunityPrimaryFilter(closedRow, 'por_decidir'), false, 'Un registro cerrado nunca aparece bajo Por decidir.');
  assert.equal(matchesOpportunityPrimaryFilter(closedRow, 'en_curso'), false, 'Un registro cerrado nunca aparece bajo En curso.');
  assert.equal(matchesOpportunityPrimaryFilter(closedRow, 'all'), true, 'Todas es unfiltered: también incluye los registros cerrados.');
}
assert.equal(matchesOpportunityPrimaryFilter(pendingRow, 'por_decidir'), true, 'Por decidir debe mapear a la clasificación interna por_decidir.');
assert.equal(matchesOpportunityPrimaryFilter(activeRow, 'en_curso'), true, 'En curso debe mapear a la clasificación interna en_curso.');

// --- Approved contract: the primary filter renders as a compact button group (aria-pressed), not
// a <select>, and no visible "Cerradas" button exists. ---
assert.doesNotMatch(opportunitiesView, /<select[^>]*value=\{filter\}/, 'El filtro primario debe renderizarse como botones compactos, no como <select>.');
assert.match(opportunitiesView, /aria-pressed=\{filter === 'all'\}/, 'El botón Todas debe declarar su estado activo con aria-pressed.');
assert.match(opportunitiesView, /aria-pressed=\{filter === 'por_decidir'\}/, 'El botón Por decidir debe declarar su estado activo con aria-pressed.');
assert.match(opportunitiesView, /aria-pressed=\{filter === 'en_curso'\}/, 'El botón En curso debe declarar su estado activo con aria-pressed.');
const ariaPressedButtons = opportunitiesView.match(/aria-pressed=\{filter ===/g) || [];
assert.equal(ariaPressedButtons.length, 3, 'Deben existir exactamente tres botones de filtro compactos (ninguno para Cerradas).');
assert.match(opportunitiesView, /useState<TenderOpportunityPrimaryFilter>\('all'\)/, 'El filtro por defecto debe ser Todas.');

// --- Approved contract: every card is truthful about amount, closing date, responsible, reference,
// location, priority, blocker and last update, degrading to exact fallback copy when data is missing. ---
for (const [field, fallback] of [
  ['offer_value', 'Monto por definir'],
  ['expected_close_date', 'Cierre por definir'],
  ['owner_name', 'Responsable por asignar'],
  ['ref', 'Referencia por definir'],
  ['city', 'Ubicación por definir'],
  ['tracking_blocker', 'Sin bloqueadores'],
  ['last_updated_at', 'Actualización por definir'],
]) {
  const escapedFallback = fallback.replace(/\s/g, '\\s');
  const proximity = new RegExp(`dossier\\.${field}[\\s\\S]{0,140}${escapedFallback}|${escapedFallback}[\\s\\S]{0,140}dossier\\.${field}`);
  assert.match(opportunitiesView, proximity, `dossier.${field} debe degradar al texto veraz "${fallback}" cuando falte.`);
}
assert.match(opportunitiesView, /Intl\.NumberFormat\('es-CO',\s*\{\s*style:\s*'currency',\s*currency:\s*'COP'/, 'El monto debe formatearse en pesos colombianos (COP), como el resto del módulo.');
assert.match(opportunitiesView, /formatDateOnly\(dossier\.expected_close_date/, 'El cierre debe usar el formateador de fecha-only existente (zona horaria segura).');
assert.match(opportunitiesView, /dateStyle:\s*'medium',\s*timeStyle:\s*'short'/, 'La última actualización debe usar la convención de fecha y hora ya establecida en el módulo de licitaciones.');

// --- Approved contract: priority uses the section mapping only (hacer/revisar/prioridad_baja). ---
assert.match(opportunitiesView, /tenderOpportunityPriorityLabel\(dossier\.section\)/, 'La prioridad de la tarjeta debe derivarse de dossier.section mediante el mapeo gobernado.');

const statusLabelsBundle = buildSync({
  entryPoints: [new URL('../src/tenders/statusLabels.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const statusLabelsUrl = `data:text/javascript;base64,${Buffer.from(statusLabelsBundle.outputFiles[0].contents).toString('base64')}`;
const { tenderOpportunityPriorityLabel } = await import(statusLabelsUrl);
assert.equal(tenderOpportunityPriorityLabel('hacer'), 'Alta');
assert.equal(tenderOpportunityPriorityLabel('revisar'), 'Media');
assert.equal(tenderOpportunityPriorityLabel('prioridad_baja'), 'Baja');
assert.equal(tenderOpportunityPriorityLabel('desconocido'), 'Por definir');
assert.equal(tenderOpportunityPriorityLabel(null), 'Por definir');
assert.equal(tenderOpportunityPriorityLabel(undefined), 'Por definir');

// --- Approved contract: the opportunities-list backend exposes owner_name, offer_value,
// expected_close_date and a last_updated_at fallback (opportunity.updated_at, then the tender's
// tracking_updated_at/last_seen_at), while preserving the tender fallback base. ---
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const summaryStart = server.indexOf('export async function buildTenderOpportunitySummary');
assert.ok(summaryStart >= 0, 'Debe existir buildTenderOpportunitySummary en el backend.');
const summaryEnd = server.indexOf('export const buildTenderDossierSummary', summaryStart);
assert.ok(summaryEnd > summaryStart, 'buildTenderOpportunitySummary debe preceder a su alias buildTenderDossierSummary.');
const summaryBlock = server.slice(summaryStart, summaryEnd);
assert.match(summaryBlock, /\.\.\.dbTenderToPublic\(tender\)/, 'El respaldo íntegro de la licitación (tender fallback) debe conservarse como base del resumen.');
for (const field of ['owner_name', 'offer_value', 'expected_close_date']) {
  assert.match(summaryBlock, new RegExp(`opportunity\\?\\.${field}`), `El resumen de oportunidades debe exponer ${field} desde la oportunidad convertida.`);
}
assert.match(
  summaryBlock,
  /last_updated_at:\s*opportunity\?\.updated_at\s*\|\|\s*tender\.tracking_updated_at\s*\|\|\s*tender\.last_seen_at\s*\|\|\s*null/,
  'last_updated_at debe respaldarse primero en updated_at de la oportunidad y luego en tracking_updated_at/last_seen_at de la licitación.'
);

// --- Blocking regression guard: the card renders dossier.tracking_blocker || 'Sin bloqueadores',
// but neither buildTenderOpportunitySummary nor dbTenderToPublic forwards tender.tracking_blocker.
// Without an explicit pass-through, a tender with a real blocker would silently render "Sin
// bloqueadores". Both backend copies (server/index.js and api/[...path].js) must populate the
// summary fallback with tracking_blocker: tender.tracking_blocker || null, adjacent to the other
// summary fields. ---
const trackingBlockerFallbackPattern = /tracking_blocker:\s*tender\.tracking_blocker\s*\|\|\s*null/;
assert.match(
  summaryBlock,
  trackingBlockerFallbackPattern,
  'buildTenderOpportunitySummary (server/index.js) debe exponer tracking_blocker: tender.tracking_blocker || null en el fallback del resumen, junto a los demás campos del resumen.'
);

const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const apiSummaryStart = apiSource.indexOf('export async function buildTenderOpportunitySummary');
assert.ok(apiSummaryStart >= 0, 'Debe existir buildTenderOpportunitySummary en api/[...path].js.');
const apiSummaryEnd = apiSource.indexOf('export const buildTenderDossierSummary', apiSummaryStart);
assert.ok(apiSummaryEnd > apiSummaryStart, 'buildTenderOpportunitySummary debe preceder a su alias buildTenderDossierSummary en api/[...path].js.');
const apiSummaryBlock = apiSource.slice(apiSummaryStart, apiSummaryEnd);
assert.match(
  apiSummaryBlock,
  trackingBlockerFallbackPattern,
  'buildTenderOpportunitySummary (api/[...path].js) debe exponer tracking_blocker: tender.tracking_blocker || null en el fallback del resumen, junto a los demás campos del resumen.'
);
assert.equal(
  summaryBlock.match(trackingBlockerFallbackPattern) ? true : false,
  apiSummaryBlock.match(trackingBlockerFallbackPattern) ? true : false,
  'server/index.js y api/[...path].js deben mantener paridad: ambos deben forwardear tracking_blocker de la misma forma.'
);

console.log('tender opportunity lifecycle filters passed');
