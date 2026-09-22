// Filtros primarios de la bandeja de oportunidades (simplify-opportunity-filter).
//
// Requisito de producto: los filtros primarios son exactamente Todas / Por decidir / En curso /
// Cerradas y son mutuamente excluyentes. El detalle GO/preparación/presentada/adjudicada sigue
// viviendo en la tarjeta: este archivo NO cubre la tarjeta, sólo el clasificador puro y su cableado.
//
// Semántica gobernada (una sola fuente de verdad: src/tenders/opportunityStage.ts):
//   Cerradas  = NO GO humano  O  estado terminal (adjudicada / no_adjudicada / cerrada_no_go)
//   Por decidir = sin decisión humana GO/NO GO (ausente o pendiente)
//   En curso  = GO humano y no terminal (en_preparacion / lista_para_presentar / presentada)
// El orden importa: Cerradas gana sobre campos contradictorios rancios; después, por decidir vs
// en curso queda determinado únicamente por la presencia de la decisión humana.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

function loadModule(relativePath) {
  const bundle = buildSync({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}

const {
  OPPORTUNITY_PRIMARY_FILTER_OPTIONS,
  classifyOpportunityStage,
  matchesOpportunityPrimaryFilter,
  normalizeOpportunityPrimaryFilter,
  opportunityQueryFilter,
} = await loadModule('../src/tenders/opportunityStage.ts');
const { filterOpportunitySummaries } = await loadModule('../src/tenders/viewUtils.ts');

const opportunitiesView = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
const listingSql = readFileSync(new URL('../supabase/migrations/088_tender_opportunity_primary_stage_filters.sql', import.meta.url), 'utf8');
const serverBackend = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiBackend = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const opportunityTypes = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');

test('los filtros primarios son exactamente Todas / Por decidir / En curso / Cerradas', () => {
  assert.deepEqual(OPPORTUNITY_PRIMARY_FILTER_OPTIONS.map(option => option.value), ['all', 'por_decidir', 'en_curso', 'cerradas']);
  assert.deepEqual(OPPORTUNITY_PRIMARY_FILTER_OPTIONS.map(option => option.label), ['Todas', 'Por decidir', 'En curso', 'Cerradas']);
});

test('Cerradas gana sobre cualquier campo contradictorio rancio', () => {
  // NO GO humano cierra la oportunidad aunque el estado de oferta se haya quedado atrás.
  assert.equal(classifyOpportunityStage({ decision: 'no_go', tender_offer_status: 'en_preparacion' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: 'no_go', tender_offer_status: 'lista_para_presentar' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: 'no_go', tender_offer_status: 'presentada' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: 'no_go', tender_offer_status: 'pendiente_decision' }), 'cerradas');
  // Un estado terminal cierra la oportunidad aunque la decisión vigente diga GO o falte.
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'cerrada_no_go' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'adjudicada' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'no_adjudicada' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'adjudicada' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'no_adjudicada' }), 'cerradas');
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'cerrada_no_go' }), 'cerradas');
});

test('Por decidir es exactamente la ausencia de decisión humana GO/NO GO', () => {
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'pendiente_decision' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({ tender_offer_status: 'pendiente_decision' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({}), 'por_decidir');
  // Una decisión "pendiente" no es una decisión humana.
  assert.equal(classifyOpportunityStage({ decision: 'pending', tender_offer_status: 'pendiente_decision' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({ decision: '', tender_offer_status: 'pendiente_decision' }), 'por_decidir');
  // La recomendación del sistema NUNCA sustituye a la decisión humana.
  assert.equal(classifyOpportunityStage({ recommendation: 'GO', decision: null, tender_offer_status: 'pendiente_decision' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({ recommendation: 'NO GO', decision: null, tender_offer_status: 'pendiente_decision' }), 'por_decidir');
  // Sin decisión humana, un estado de preparación rancio sigue siendo "por decidir".
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'en_preparacion' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'lista_para_presentar' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'presentada' }), 'por_decidir');
});

test('En curso es GO humano mientras no sea terminal, preparación y presentada incluidas', () => {
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'en_preparacion' }), 'en_curso');
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'lista_para_presentar' }), 'en_curso');
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'presentada' }), 'en_curso');
  // GO registrado antes de que el estado de oferta avance: sigue siendo trabajo en curso.
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'pendiente_decision' }), 'en_curso');
  assert.equal(classifyOpportunityStage({ decision: 'go' }), 'en_curso');
});

test('el clasificador es total y determinista ante entradas basura', () => {
  assert.equal(classifyOpportunityStage(null), 'por_decidir');
  assert.equal(classifyOpportunityStage(undefined), 'por_decidir');
  assert.equal(classifyOpportunityStage({ decision: 'go', tender_offer_status: 'estado_desconocido' }), 'en_curso');
  assert.equal(classifyOpportunityStage({ decision: null, tender_offer_status: 'estado_desconocido' }), 'por_decidir');
  assert.equal(classifyOpportunityStage({ decision: 'GO', tender_offer_status: 'en_preparacion' }), 'por_decidir');
});

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
  { id: 'stale-prep-no-decision', decision: null, tender_offer_status: 'en_preparacion' },
  { id: 'go-before-status', decision: 'go', tender_offer_status: 'pendiente_decision' },
];

test('los tres estados primarios particionan cualquier bandeja: ni solapamiento ni huérfanos', () => {
  const stages = ['por_decidir', 'en_curso', 'cerradas'];
  for (const row of rows) {
    const hits = stages.filter(stage => matchesOpportunityPrimaryFilter(row, stage));
    assert.deepEqual(hits.length, 1, `${row.id} debe caer en exactamente un filtro primario, cayó en ${hits.join(', ') || 'ninguno'}`);
    assert.ok(matchesOpportunityPrimaryFilter(row, 'all'), `${row.id} siempre debe verse en Todas`);
  }
});

test('filterOpportunitySummaries particiona la bandeja con el vocabulario primario', () => {
  assert.deepEqual(filterOpportunitySummaries(rows, 'all').map(row => row.id), rows.map(row => row.id));
  assert.deepEqual(filterOpportunitySummaries(rows, 'por_decidir').map(row => row.id), ['pending', 'recommendation-only', 'stale-prep-no-decision']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'en_curso').map(row => row.id), ['go-active', 'go-presented', 'ready', 'go-before-status']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'cerradas').map(row => row.id), ['pending-decided', 'go-revoked', 'no-go', 'awarded', 'not-awarded']);
});

test('el vocabulario legado del backend sigue siendo aceptado sin cambiar de semántica', () => {
  // El RPC y /api/tender-opportunities siguen hablando este vocabulario por compatibilidad.
  assert.deepEqual(filterOpportunitySummaries(rows, 'pending_decision').map(row => row.id), ['pending', 'recommendation-only']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'go_authorized').map(row => row.id), ['go-active', 'go-presented', 'ready']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'submitted').map(row => row.id), ['go-presented']);
  assert.throws(() => filterOpportunitySummaries(rows, 'invalid'), /filtro/i);
});

test('un valor de filtro viejo o desconocido degrada a Todas', () => {
  // No existe persistencia en URL del filtro de oportunidades (el estado vive en useState), así que
  // ningún valor legado necesita sobrevivir un enlace compartido: degradan todos a Todas.
  for (const legacy of ['pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed', 'pending', 'preparing', 'awarded', 'rejected', '', null, undefined, 42, {}]) {
    assert.equal(normalizeOpportunityPrimaryFilter(legacy), 'all', `${String(legacy)} debe degradar a Todas`);
  }
  for (const option of OPPORTUNITY_PRIMARY_FILTER_OPTIONS) {
    assert.equal(normalizeOpportunityPrimaryFilter(option.value), option.value);
  }
});

test('el filtro primario viaja tal cual al backend, sin traducirse a un predicado más estrecho', () => {
  // Traducir `por_decidir -> pending_decision`, `en_curso -> go_authorized` y `cerradas -> closed`
  // perdía filas: los predicados legados son MÁS ESTRECHOS que los estados primarios y el cliente
  // no puede recuperar lo que el SQL no devolvió. El vocabulario primario es ahora el del RPC.
  assert.equal(opportunityQueryFilter('all'), 'all');
  assert.equal(opportunityQueryFilter('por_decidir'), 'por_decidir');
  assert.equal(opportunityQueryFilter('en_curso'), 'en_curso');
  assert.equal(opportunityQueryFilter('cerradas'), 'cerradas');
  assert.equal(opportunityQueryFilter('desconocido'), 'all');
  assert.equal(opportunityQueryFilter('pending_decision'), 'all', 'un valor legado del selector degrada a Todas, no a un predicado estrecho');
});

test('el vocabulario primario llega intacto al RPC y a la validación de la API', () => {
  const accepted = listingSql.match(/p_filter not in \(([^)]*)\)/)[1].split(',').map(value => value.trim().replace(/'/g, ''));
  for (const option of OPPORTUNITY_PRIMARY_FILTER_OPTIONS) {
    assert.equal(opportunityQueryFilter(option.value), option.value);
    assert.ok(accepted.includes(option.value), `${option.value} debe ser un filtro que el RPC acepta directamente`);
  }
  // La validación de la API vive duplicada byte a byte en server/index.js y api/[...path].js.
  for (const [name, backend] of [['server/index.js', serverBackend], ['api/[...path].js', apiBackend]]) {
    const declared = backend.match(/const tenderOpportunityFilters = new Set\(\[([^\]]*)\]\)/)[1]
      .split(',').map(value => value.trim().replace(/'/g, '')).filter(Boolean);
    for (const option of OPPORTUNITY_PRIMARY_FILTER_OPTIONS) {
      assert.ok(declared.includes(option.value), `${name} debe aceptar el filtro primario ${option.value}`);
    }
    for (const legacy of ['pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
      assert.ok(declared.includes(legacy), `${name} debe seguir aceptando el filtro legado ${legacy}`);
    }
    assert.ok(!declared.includes('legacy'), `${name} no debe aceptar filtros inventados`);
  }
  // El tipo del contrato de red debe cubrir ambos vocabularios.
  const wireFilter = opportunityTypes.match(/export type TenderOpportunityFilter = ([^;]*);/)[1];
  for (const value of ['all', 'por_decidir', 'en_curso', 'cerradas', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
    assert.ok(wireFilter.includes(`'${value}'`), `TenderOpportunityFilter debe incluir ${value}`);
  }
});

test('la vista de oportunidades ofrece los cuatro filtros primarios y ninguno de los viejos', () => {
  // El selector se renderiza desde la ÚNICA lista de opciones primarias: no hay rótulos sueltos.
  assert.match(opportunitiesView, /OPPORTUNITY_PRIMARY_FILTER_OPTIONS\.map/, 'el selector debe renderizarse desde la lista primaria');
  assert.ok(!/<option value="/.test(opportunitiesView), 'el selector no debe declarar opciones literales fuera de la lista primaria');
  for (const retired of ['Pendiente de decisión', 'GO registrado', 'Presentadas', 'pending_decision', 'go_authorized', 'in_preparation']) {
    assert.ok(!opportunitiesView.includes(retired), `la vista ya no debe ofrecer el filtro ${retired}`);
  }
  assert.match(opportunitiesView, /opportunityQueryFilter/, 'la vista debe enviar el filtro primario ya normalizado');
  assert.match(opportunitiesView, /setFilter\([\s\S]*?setPage\(1\)/, 'cambiar filtro debe reiniciar la página');
});

test('la vista no vuelve a filtrar la página recibida: eso dejaba páginas ralas', () => {
  // El servidor ya aplica EXACTAMENTE el mismo predicado primario. Volver a filtrar en el cliente
  // sólo puede quitar filas de una página que el SQL ya acotó y paginó: una página de 25 se
  // mostraría con menos de 25 sin que el paginador lo sepa.
  assert.ok(
    !/rows\.filter\(row => matchesOpportunityPrimaryFilter/.test(opportunitiesView),
    'la vista no debe recortar la página del servidor con el clasificador puro',
  );
  assert.ok(
    !/filterOpportunitySummaries\(/.test(opportunitiesView),
    'la vista no debe re-filtrar la página del servidor',
  );
});

test('contrato estático y aislado: filtro primario pasa directo, backend y tipos lo aceptan', () => {
  // (1) opportunityQueryFilter debe devolver el vocabulario primario tal cual, nunca el legado.
  assert.equal(opportunityQueryFilter('por_decidir'), 'por_decidir');
  assert.equal(opportunityQueryFilter('en_curso'), 'en_curso');
  assert.equal(opportunityQueryFilter('cerradas'), 'cerradas');
  assert.notEqual(opportunityQueryFilter('por_decidir'), 'pending_decision');
  assert.notEqual(opportunityQueryFilter('en_curso'), 'go_authorized');
  assert.notEqual(opportunityQueryFilter('cerradas'), 'closed');

  // (2) server/index.js y api/[...path].js deben aceptar los tres valores primarios sin dejar de
  // aceptar el vocabulario legado (compatibilidad).
  for (const [name, backend] of [['server/index.js', serverBackend], ['api/[...path].js', apiBackend]]) {
    const declared = backend.match(/const tenderOpportunityFilters = new Set\(\[([^\]]*)\]\)/)[1]
      .split(',').map(value => value.trim().replace(/'/g, '')).filter(Boolean);
    for (const primary of ['por_decidir', 'en_curso', 'cerradas']) {
      assert.ok(declared.includes(primary), `${name} debe aceptar el valor primario ${primary}`);
    }
    for (const legacy of ['pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
      assert.ok(declared.includes(legacy), `${name} debe seguir aceptando el valor legado ${legacy} por compatibilidad`);
    }
  }

  // (3) TenderOpportunityFilter debe incluir los tres valores primarios en su unión de tipos.
  const wireFilter = opportunityTypes.match(/export type TenderOpportunityFilter = ([^;]*);/)[1];
  for (const primary of ['por_decidir', 'en_curso', 'cerradas']) {
    assert.ok(wireFilter.includes(`'${primary}'`), `TenderOpportunityFilter debe incluir '${primary}'`);
  }
});

test('la tarjeta conserva su detalle de estado: no hay rediseño visual', () => {
  for (const label of ['Recomendación del sistema', 'Decisión humana', 'Estado de oferta', 'Documentos', 'Checklist', 'Preparación', 'Pendientes humanos', 'SharePoint / OneDrive']) {
    assert.ok(opportunitiesView.includes(label), `la tarjeta debe conservar ${label}`);
  }
  assert.match(opportunitiesView, /tenderOfferStatusLabel\(dossier\.tender_offer_status\)/, 'la tarjeta conserva el badge de estado de oferta');
  assert.match(opportunitiesView, /tenderDecisionLabel\(dossier\.decision\)/, 'la tarjeta conserva la decisión humana detallada');
});
