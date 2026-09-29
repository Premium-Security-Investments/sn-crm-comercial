// Filtros primarios de la bandeja de oportunidades (simplify-opportunity-filter).
//
// Requisito de producto: los filtros primarios SELECCIONABLES en la UI son exactamente Todas /
// Por decidir / En curso y son mutuamente excluyentes. No existe un botón de Cerradas: las
// oportunidades cerradas sólo se ven a través de Todas. El detalle GO/preparación/presentada/
// adjudicada sigue viviendo en la tarjeta: este archivo NO cubre la tarjeta, sólo el clasificador
// puro y su cableado.
//
// El clasificador interno (src/tenders/opportunityStage.ts) sigue particionando la bandeja en TRES
// estados — por_decidir / en_curso / cerradas — y el backend/RPC/tipo de red siguen aceptando
// 'cerradas' y el vocabulario legado por compatibilidad (migración 088 sin cambios). Lo único que
// cambió es qué valores puede elegir un humano en la UI: 'cerradas' ya no es uno de ellos y
// normaliza a 'all'.
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

test('los filtros primarios seleccionables son exactamente Todas / Por decidir / En curso', () => {
  assert.deepEqual(OPPORTUNITY_PRIMARY_FILTER_OPTIONS.map(option => option.value), ['all', 'por_decidir', 'en_curso']);
  assert.deepEqual(OPPORTUNITY_PRIMARY_FILTER_OPTIONS.map(option => option.label), ['Todas', 'Por decidir', 'En curso']);
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

test('los tres estados primarios internos particionan cualquier bandeja: ni solapamiento ni huérfanos', () => {
  const stages = ['por_decidir', 'en_curso', 'cerradas'];
  for (const row of rows) {
    const hits = stages.filter(stage => matchesOpportunityPrimaryFilter(row, stage));
    assert.deepEqual(hits.length, 1, `${row.id} debe caer en exactamente un filtro primario, cayó en ${hits.join(', ') || 'ninguno'}`);
    assert.ok(matchesOpportunityPrimaryFilter(row, 'all'), `${row.id} siempre debe verse en Todas`);
  }
});

test('filterOpportunitySummaries particiona la bandeja con el vocabulario primario seleccionable', () => {
  assert.deepEqual(filterOpportunitySummaries(rows, 'all').map(row => row.id), rows.map(row => row.id));
  assert.deepEqual(filterOpportunitySummaries(rows, 'por_decidir').map(row => row.id), ['pending', 'recommendation-only', 'stale-prep-no-decision']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'en_curso').map(row => row.id), ['go-active', 'go-presented', 'ready', 'go-before-status']);
  // 'cerradas' ya no está en OPPORTUNITY_PRIMARY_FILTER_OPTIONS, así que dejó de ser un valor que
  // filterOpportunitySummaries reconozca como primario; las filas cerradas se siguen viendo a través
  // de 'all', y el estado interno se prueba aparte con matchesOpportunityPrimaryFilter arriba.
  assert.throws(() => filterOpportunitySummaries(rows, 'cerradas'), /filtro/i);
});

test('el vocabulario legado del backend sigue siendo aceptado sin cambiar de semántica', () => {
  // El RPC y /api/tender-opportunities siguen hablando este vocabulario por compatibilidad.
  assert.deepEqual(filterOpportunitySummaries(rows, 'pending_decision').map(row => row.id), ['pending', 'recommendation-only']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'go_authorized').map(row => row.id), ['go-active', 'go-presented', 'ready']);
  assert.deepEqual(filterOpportunitySummaries(rows, 'submitted').map(row => row.id), ['go-presented']);
  assert.throws(() => filterOpportunitySummaries(rows, 'invalid'), /filtro/i);
});

test('un valor de filtro viejo, cerrado o desconocido degrada a Todas', () => {
  // No existe persistencia en URL del filtro de oportunidades (el estado vive en useState), así que
  // ningún valor legado ni el estado interno 'cerradas' necesitan sobrevivir un enlace compartido:
  // degradan todos a Todas. 'cerradas' dejó de ser seleccionable en la UI (ya no hay botón de
  // Cerradas); sólo el clasificador interno lo sigue usando.
  for (const legacy of ['cerradas', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed', 'pending', 'preparing', 'awarded', 'rejected', '', null, undefined, 42, {}]) {
    assert.equal(normalizeOpportunityPrimaryFilter(legacy), 'all', `${String(legacy)} debe degradar a Todas`);
  }
  for (const option of OPPORTUNITY_PRIMARY_FILTER_OPTIONS) {
    assert.equal(normalizeOpportunityPrimaryFilter(option.value), option.value);
  }
});

test('el filtro seleccionable viaja tal cual al backend; cerradas ya no es seleccionable y degrada a Todas', () => {
  // Traducir `por_decidir -> pending_decision` y `en_curso -> go_authorized` perdía filas: los
  // predicados legados son MÁS ESTRECHOS que los estados primarios y el cliente no puede recuperar
  // lo que el SQL no devolvió. El vocabulario primario seleccionable (all/por_decidir/en_curso) es
  // el que ahora habla el RPC directamente. 'cerradas' sigue siendo válido para el backend/RPC por
  // compatibilidad, pero ya no es un valor que la UI pueda producir, así que opportunityQueryFilter
  // lo trata como cualquier otro valor no ofrecido: degrada a Todas.
  assert.equal(opportunityQueryFilter('all'), 'all');
  assert.equal(opportunityQueryFilter('por_decidir'), 'por_decidir');
  assert.equal(opportunityQueryFilter('en_curso'), 'en_curso');
  assert.equal(opportunityQueryFilter('cerradas'), 'all', 'cerradas ya no es seleccionable en la UI: degrada a Todas');
  assert.equal(opportunityQueryFilter('desconocido'), 'all');
  assert.equal(opportunityQueryFilter('pending_decision'), 'all', 'un valor legado del selector degrada a Todas, no a un predicado estrecho');
});

test('el vocabulario primario seleccionable llega intacto al RPC y a la validación de la API; cerradas sigue aceptado por compatibilidad', () => {
  const accepted = listingSql.match(/p_filter not in \(([^)]*)\)/)[1].split(',').map(value => value.trim().replace(/'/g, ''));
  for (const option of OPPORTUNITY_PRIMARY_FILTER_OPTIONS) {
    assert.equal(opportunityQueryFilter(option.value), option.value);
    assert.ok(accepted.includes(option.value), `${option.value} debe ser un filtro que el RPC acepta directamente`);
  }
  // El RPC sigue aceptando 'cerradas' aunque ya no sea seleccionable desde la UI: el clasificador
  // interno y cualquier consumidor directo del backend lo siguen usando (migración 088 sin cambios).
  assert.ok(accepted.includes('cerradas'), 'el RPC debe seguir aceptando cerradas por compatibilidad interna');
  // La validación de la API vive duplicada byte a byte en server/index.js y api/[...path].js.
  for (const [name, backend] of [['server/index.js', serverBackend], ['api/[...path].js', apiBackend]]) {
    const declared = backend.match(/const tenderOpportunityFilters = new Set\(\[([^\]]*)\]\)/)[1]
      .split(',').map(value => value.trim().replace(/'/g, '')).filter(Boolean);
    for (const option of OPPORTUNITY_PRIMARY_FILTER_OPTIONS) {
      assert.ok(declared.includes(option.value), `${name} debe aceptar el filtro primario ${option.value}`);
    }
    assert.ok(declared.includes('cerradas'), `${name} debe seguir aceptando cerradas por compatibilidad`);
    for (const legacy of ['pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
      assert.ok(declared.includes(legacy), `${name} debe seguir aceptando el filtro legado ${legacy}`);
    }
    assert.ok(!declared.includes('legacy'), `${name} no debe aceptar filtros inventados`);
  }
  // El tipo del contrato de red debe cubrir ambos vocabularios, incluido 'cerradas'.
  const wireFilter = opportunityTypes.match(/export type TenderOpportunityFilter = ([^;]*);/)[1];
  for (const value of ['all', 'por_decidir', 'en_curso', 'cerradas', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
    assert.ok(wireFilter.includes(`'${value}'`), `TenderOpportunityFilter debe incluir ${value}`);
  }
});

test('la vista de oportunidades ofrece exactamente tres filtros primarios seleccionables y ningún botón de Cerradas', () => {
  // Los tres filtros seleccionables son botones explícitos con aria-pressed y rótulo visible, no una
  // lista derivada de OPPORTUNITY_PRIMARY_FILTER_OPTIONS.map: el estado interno "cerradas" sigue
  // existiendo en el clasificador, pero ya no tiene un control visible en la bandeja.
  const filterButtons = [...opportunitiesView.matchAll(/aria-pressed=\{filter === '([a-z_]+)'\}[^>]*onClick=\{\(\) => \{ setFilter\('([a-z_]+)'\); setPage\(1\); \}\}>([^<]+)</g)];
  assert.deepEqual(filterButtons.map(match => [match[1], match[2], match[3]]), [
    ['all', 'all', 'Todas'],
    ['por_decidir', 'por_decidir', 'Por decidir'],
    ['en_curso', 'en_curso', 'En curso'],
  ], 'debe haber exactamente tres botones, cada uno con aria-pressed y reinicio de página al hacer clic');
  assert.ok(!/aria-pressed=\{filter === 'cerradas'\}/.test(opportunitiesView), 'no debe existir un control con aria-pressed para cerradas');
  assert.ok(!opportunitiesView.includes('>Cerradas<'), 'no debe existir un botón visible de Cerradas');
  assert.ok(!/<option value="/.test(opportunitiesView), 'el selector no debe volver a un <select> con opciones literales');
  for (const retired of ['Pendiente de decisión', 'GO registrado', 'Presentadas', 'pending_decision', 'go_authorized', 'in_preparation']) {
    assert.ok(!opportunitiesView.includes(retired), `la vista ya no debe ofrecer el filtro ${retired}`);
  }
  assert.match(opportunitiesView, /opportunityQueryFilter/, 'la vista debe enviar el filtro primario ya normalizado');
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

test('contrato estático y aislado: filtro seleccionable pasa directo, backend y tipos siguen aceptando cerradas', () => {
  // (1) opportunityQueryFilter debe devolver el vocabulario primario seleccionable tal cual, nunca
  // el legado. 'cerradas' ya no es seleccionable: degrada a 'all' como cualquier otro valor fuera de
  // OPPORTUNITY_PRIMARY_FILTER_OPTIONS.
  assert.equal(opportunityQueryFilter('por_decidir'), 'por_decidir');
  assert.equal(opportunityQueryFilter('en_curso'), 'en_curso');
  assert.equal(opportunityQueryFilter('cerradas'), 'all');
  assert.notEqual(opportunityQueryFilter('por_decidir'), 'pending_decision');
  assert.notEqual(opportunityQueryFilter('en_curso'), 'go_authorized');

  // (2) server/index.js y api/[...path].js deben seguir aceptando 'cerradas' además de los valores
  // primarios seleccionables y el vocabulario legado (compatibilidad interna, migración 088 sin
  // cambios).
  for (const [name, backend] of [['server/index.js', serverBackend], ['api/[...path].js', apiBackend]]) {
    const declared = backend.match(/const tenderOpportunityFilters = new Set\(\[([^\]]*)\]\)/)[1]
      .split(',').map(value => value.trim().replace(/'/g, '')).filter(Boolean);
    for (const primary of ['por_decidir', 'en_curso', 'cerradas']) {
      assert.ok(declared.includes(primary), `${name} debe aceptar el valor ${primary}`);
    }
    for (const legacy of ['pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
      assert.ok(declared.includes(legacy), `${name} debe seguir aceptando el valor legado ${legacy} por compatibilidad`);
    }
  }

  // (3) TenderOpportunityFilter debe seguir incluyendo 'cerradas' además de los valores primarios
  // seleccionables en su unión de tipos.
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
