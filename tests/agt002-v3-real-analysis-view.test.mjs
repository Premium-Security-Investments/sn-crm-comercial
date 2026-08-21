import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { runAgt002ManizalesV3LocalRun } from '../scripts/agt002-manizales-v3-local-run.mjs';

// AGT-002 Task 4 · el respaldo técnico V3 es una lectura humana completa en dos capas.
// Las pruebas principales corren sobre el HTML realmente renderizado (renderToStaticMarkup):
// la primera capa es legible y no imprime códigos técnicos; la segunda capa
// (`Ver trazabilidad técnica`) conserva íntegramente unit_id, requirement_id, referencias,
// localizadores, los cinco ejes de evidence_state y el cierre.
// Se prueba con dos fixtures de tamaño, categorías y conclusiones distintas: la corrida local del
// piloto y `tests/fixtures/tender-integral-analysis-dynamic.v3.json`.
// Sin red, sin base de datos, sin commit/push/deploy.

const root = new URL('../', import.meta.url);
const componentPath = new URL('src/tenders/components/TenderIntegralAnalysisV3View.tsx', root);
const cssPath = new URL('src/tenders/components/tender-integral-analysis-v3.css', root);
const source = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

const cacheDir = new URL('node_modules/.cache/agt002-task4-v3-render/', root);
mkdirSync(cacheDir, { recursive: true });
const outfile = new URL('TenderIntegralAnalysisV3View.mjs', cacheDir).pathname;
buildSync({
  entryPoints: [componentPath.pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  // React must stay a single instance shared with react-dom/server.
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  outfile,
  write: true,
});
const { TenderIntegralAnalysisV3View } = await import(pathToFileURL(outfile).href);

const DYNAMIC = JSON.parse(readFileSync(new URL('fixtures/tender-integral-analysis-dynamic.v3.json', new URL('./', import.meta.url)), 'utf8'));
const PILOT = (await runAgt002ManizalesV3LocalRun()).envelope;

const render = analysis => renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis }));
const dynamicHtml = render(DYNAMIC);
const pilotHtml = render(PILOT);

// La segunda capa vive siempre en `<details class="agt002-v3-trace">`; separarla del HTML deja
// exactamente la primera capa humana.
const TRACE_PATTERN = /<details class="agt002-v3-trace"[^>]*>[\s\S]*?<\/details>/g;
function layers(html) {
  const traces = html.match(TRACE_PATTERN) ?? [];
  return { first: html.replace(TRACE_PATTERN, ''), trace: traces.join('\n') };
}
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const DYNAMIC_UNITS = DYNAMIC.integral_analysis.analysis_units;
const PILOT_UNITS = PILOT.integral_analysis.analysis_units;

// ---------------------------------------------------------------------------------------------
// 1 · Resumen calculado desde los arreglos reales; la suma por estado es analysis_units.length.
// ---------------------------------------------------------------------------------------------
test('el resumen muestra el total de unidades y conteos por estado cuya suma es analysis_units.length', () => {
  for (const [html, units] of [[dynamicHtml, DYNAMIC_UNITS], [pilotHtml, PILOT_UNITS]]) {
    assert.ok(html.includes(`<dt>Requisitos analizados</dt><dd>${units.length}</dd>`), 'el total debe salir del arreglo real');
    const counts = new Map();
    const LABELS = {
      supported_with_evidence: 'Sustentado con evidencia',
      partially_supported: 'Sustento parcial',
      gap_evidenced: 'Brecha evidenciada',
      insufficient_evidence: 'Evidencia insuficiente',
      human_validation_required: 'Revisión humana requerida',
    };
    for (const unit of units) {
      const label = LABELS[unit.conclusion.status] ?? 'Por revisar';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    let rendered = 0;
    for (const [label, count] of counts) {
      assert.ok(html.includes(`<dt>${label}</dt><dd>${count}</dd>`), `el resumen debe rendir ${label} con ${count}`);
      rendered += count;
    }
    assert.equal(rendered, units.length, 'la suma de los conteos por estado debe ser el total de unidades');
  }
  // Nada de 25/20/5/2 quemado: los dos fixtures difieren en tamaño y ambos cuadran.
  assert.notEqual(DYNAMIC_UNITS.length, PILOT_UNITS.length);
});

test('los indicadores de evidencia se rotulan explícitamente como no excluyentes y salen de los arreglos', () => {
  const citedUnits = DYNAMIC_UNITS.filter(unit => unit.evidence_refs.length > 0).length;
  const pendingUnits = DYNAMIC_UNITS.filter(unit => unit.missing_evidence.length > 0).length;
  const citedRefs = DYNAMIC_UNITS.reduce((total, unit) => total + unit.evidence_refs.length, 0);
  const pendingItems = DYNAMIC_UNITS.reduce((total, unit) => total + unit.missing_evidence.length, 0);

  assert.ok(dynamicHtml.includes('Indicadores de evidencia (no excluyentes)'), 'el rótulo debe decir explícitamente que no son excluyentes');
  assert.ok(dynamicHtml.includes(`<dt>Unidades con referencias citadas</dt><dd>${citedUnits}</dd>`));
  assert.ok(dynamicHtml.includes(`<dt>Referencias citadas en total</dt><dd>${citedRefs}</dd>`));
  assert.ok(dynamicHtml.includes(`<dt>Unidades con evidencia pendiente</dt><dd>${pendingUnits}</dd>`));
  assert.ok(dynamicHtml.includes(`<dt>Pendientes de evidencia en total</dt><dd>${pendingItems}</dd>`));
  assert.notEqual(citedUnits + pendingUnits, DYNAMIC_UNITS.length, 'los dos indicadores no pueden leerse como complementarios');
});

// ---------------------------------------------------------------------------------------------
// 2 · Cinco categorías institucionales por diccionario cerrado; todas las unidades visibles.
// ---------------------------------------------------------------------------------------------
test('las cinco fases institucionales se renderizan en orden, incluso vacías, y una categoría desconocida cae en Por revisar', () => {
  for (const html of [dynamicHtml, pilotHtml]) {
    let previous = -1;
    for (const label of ['Descarte', 'Habilitantes', 'Técnico', 'Financiero / ejecución', 'Estratégico']) {
      const position = html.indexOf(`<strong>${label}</strong>`);
      assert.ok(position > previous, `la fase ${label} debe renderizarse una vez y en orden institucional`);
      previous = position;
    }
  }
  assert.ok(dynamicHtml.includes('<strong>Por revisar</strong>'), 'la categoría desconocida abre su propia fase de respaldo');
  assert.ok(!pilotHtml.includes('<strong>Por revisar</strong>'), 'sin categorías desconocidas no se inventa la fase de respaldo');
});

test('todas las unidades quedan renderizadas, una sola vez, en su fase', () => {
  for (const [html, units] of [[dynamicHtml, DYNAMIC_UNITS], [pilotHtml, PILOT_UNITS]]) {
    for (const unit of units) {
      assert.equal(countOf(html, `<h4>${unit.title}</h4>`), 1, `${unit.title} debe aparecer exactamente una vez`);
    }
  }
});

test('una fase con evidencia pendiente puede iniciar abierta; una sin pendientes no', () => {
  assert.match(dynamicHtml, /<details class="agt002-v3-phase" data-phase="discard" open(?:="")?>/, 'Descarte tiene evidencia pendiente y puede abrir');
  assert.match(dynamicHtml, /<details class="agt002-v3-phase" data-phase="strategic">/, 'Estratégico no tiene pendientes y no abre');
  // Abierta o cerrada, el contenido siempre está en el HTML: ninguna unidad se oculta del respaldo.
  assert.ok(dynamicHtml.includes('<h4>Conveniencia estratégica de participar</h4>'));
});

// ---------------------------------------------------------------------------------------------
// 3 · Primera capa humana: campos gobernados verbatim, sin códigos técnicos.
// ---------------------------------------------------------------------------------------------
test('la primera capa rinde los campos gobernados de §3.5 verbatim y con rótulos humanos', () => {
  const { first } = layers(dynamicHtml);
  const unit = DYNAMIC_UNITS[1];
  for (const label of ['Requisito', 'Estado', 'Conclusión', 'Soporte', 'Qué falta', 'Impacto comercial', 'Acción']) {
    assert.ok(first.includes(`<dt>${label}</dt>`) || first.includes(`>${label}<`), `debe rotular ${label}`);
  }
  assert.ok(first.includes(unit.title), 'Requisito = unit.title');
  assert.ok(first.includes('Brecha evidenciada'), 'Estado = traducción cerrada de conclusion.status');
  assert.ok(first.includes(unit.conclusion.summary), 'Conclusión = conclusion.summary verbatim');
  assert.ok(first.includes(unit.missing_evidence[0].reason), 'Qué falta = missing_evidence[].reason verbatim');
  assert.ok(first.includes(unit.commercial_impact.summary), 'Impacto comercial = summary verbatim');
  assert.ok(first.includes('Crítico'), 'Impacto comercial = traducción cerrada del nivel');
  assert.ok(first.includes(unit.actions[0].summary), 'Acción = actions[0].summary verbatim');
  assert.ok(first.includes('Documento del pliego'), 'Soporte = tipos de fuente traducidos');

  const abstained = DYNAMIC_UNITS[3];
  assert.ok(first.includes(abstained.missing_evidence[0].reason) && first.includes(abstained.missing_evidence[1].reason), 'todas las razones de evidencia faltante son visibles');
  assert.ok(first.includes('Por revisar'), 'un enum desconocido se traduce al rótulo cerrado de respaldo');
});

test('la primera capa nunca imprime unit-, requirement_id, evidence:chunk, objective_validation, char_start ni nombres de tablas', () => {
  for (const [html, units] of [[dynamicHtml, DYNAMIC_UNITS], [pilotHtml, PILOT_UNITS]]) {
    const { first } = layers(html);
    for (const banned of [/unit-/i, /requirement_id/, /evidence:chunk/, /objective_validation/, /char_start/, /\bpsi_[a-z_]+/]) {
      assert.doesNotMatch(first, banned, `la primera capa nunca puede contener ${banned}`);
    }
    for (const unit of units) {
      assert.ok(!first.includes(unit.unit_id), `la primera capa no puede imprimir el unit_id ${unit.unit_id}`);
      if (unit.requirement_id) assert.ok(!first.includes(unit.requirement_id), `la primera capa no puede imprimir ${unit.requirement_id}`);
      for (const ref of unit.evidence_refs) assert.ok(!first.includes(ref.ref), 'la primera capa no imprime localizadores crudos');
      for (const item of unit.missing_evidence) assert.ok(!first.includes(item.missing_id), 'la primera capa no imprime ids de evidencia faltante');
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 4 · Segunda capa: trazabilidad técnica completa.
// ---------------------------------------------------------------------------------------------
test('Ver trazabilidad técnica conserva unit_id, requirement_id, referencias, propósitos, localizadores, los cinco ejes y el cierre', () => {
  const { trace } = layers(dynamicHtml);
  assert.equal(
    countOf(dynamicHtml, '<summary>Ver trazabilidad técnica</summary>'),
    DYNAMIC_UNITS.length + DYNAMIC.manifest_unresolved_entries.length + 1,
    'cada unidad, cada pendiente del manifiesto y la ejecución global llevan su trazabilidad',
  );

  for (const unit of DYNAMIC_UNITS) {
    assert.ok(trace.includes(unit.unit_id), `la trazabilidad conserva ${unit.unit_id}`);
    if (unit.requirement_id) assert.ok(trace.includes(unit.requirement_id));
    for (const ref of unit.evidence_refs) assert.ok(trace.includes(ref.ref), `la trazabilidad conserva el localizador ${ref.ref}`);
    assert.ok(trace.includes(unit.closure.condition), 'la trazabilidad conserva la condición de cierre');
  }
  assert.ok(trace.includes('requirement_id'), 'la trazabilidad puede nombrar los campos crudos');
  assert.ok(trace.includes('evidence:chunk:doc-pliego:0142'));
  assert.ok(trace.includes('objective_validation'), 'la trazabilidad conserva el tipo de fuente crudo');
  assert.ok(trace.includes('estado_no_reconocido'), 'la trazabilidad conserva el enum crudo que la primera capa tradujo');
  for (const axis of ['Presencia', 'Revisión', 'Vigencia', 'Aplicabilidad', 'Sustento']) {
    assert.ok(trace.includes(axis), `la trazabilidad conserva el eje ${axis}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 5 · manifest_unresolved_entries por label y fase humana; requirement_id sólo en trazabilidad.
// ---------------------------------------------------------------------------------------------
test('los pendientes del manifiesto se presentan por label y fase humana, con requirement_id sólo en su trazabilidad', () => {
  const { first, trace } = layers(dynamicHtml);
  assert.ok(first.includes('Pendientes sin evidencia suficiente'));
  for (const entry of DYNAMIC.manifest_unresolved_entries) {
    assert.equal(countOf(first, entry.label), 1, `${entry.label} se presenta una sola vez en la capa humana`);
    assert.ok(!first.includes(entry.requirement_id), 'el requirement_id del pendiente no es texto humano');
    assert.ok(trace.includes(entry.requirement_id), 'el requirement_id del pendiente vive en la trazabilidad');
  }
  assert.ok(first.includes('Habilitantes'), 'la fase del pendiente se traduce por diccionario cerrado');
  assert.ok(first.includes('Por revisar'), 'un pendiente sin categoría cae en el rótulo cerrado');
  assert.match(first, /revisi[oó]n humana/i);
  assert.ok(!pilotHtml.includes('Pendientes sin evidencia suficiente'), 'sin pendientes del manifiesto no se inventa la sección');
});

// ---------------------------------------------------------------------------------------------
// 6 · Ver condición principal: sólo por igualdad explícita y no nula de requirement_id, y el
//     destino es un ancla gobernada, opaca y no técnica por unidad (nunca el ancla genérica de
//     Análisis ni el id gobernado crudo).
// ---------------------------------------------------------------------------------------------
test('Ver condición principal aparece sólo cuando hay igualdad no nula de requirement_id con una entrada gobernada', () => {
  const matching = DYNAMIC_UNITS.filter(unit => unit.requirement_id === 'req-dyn-experiencia' || unit.requirement_id === 'req-dyn-territorio').length;
  assert.equal(countOf(dynamicHtml, 'Ver condición principal'), matching, 'una unidad sin entrada gobernada equivalente no ofrece el enlace');

  const sinReview = render({ ...DYNAMIC, decision_review: null });
  assert.equal(countOf(sinReview, 'Ver condición principal'), 0, 'sin decision_review gobernado no hay destino seguro: se omite el enlace');
  assert.equal(countOf(pilotHtml, 'Ver condición principal'), 0);

  // Nunca por texto: mismos títulos, requirement_id que no existe en decision_review.
  const sinIgualdad = render({
    ...DYNAMIC,
    integral_analysis: {
      ...DYNAMIC.integral_analysis,
      analysis_units: DYNAMIC_UNITS.map(unit => ({ ...unit, requirement_id: unit.requirement_id ? `${unit.requirement_id}-otro` : null })),
    },
  });
  assert.equal(countOf(sinIgualdad, 'Ver condición principal'), 0);
});

test('Ver condición principal enlaza a un ancla opaca por unidad (orden estable decision_questions+blockers), nunca al ancla genérica de Análisis ni a un id gobernado crudo', () => {
  // DYNAMIC.decision_review: decision_questions = [experiencia], blockers = [territorio] →
  // orden estable decision_questions+blockers: experiencia=1, territorio=2.
  assert.ok(dynamicHtml.includes('href="#tender-condition-1"'), 'req-dyn-experiencia es la primera entrada gobernada y debe enlazar a su propio ancla');
  assert.ok(dynamicHtml.includes('href="#tender-condition-2"'), 'req-dyn-territorio es la segunda entrada gobernada y debe enlazar a su propio ancla');
  assert.ok(!dynamicHtml.includes('href="#tender-analysis"'), 'el destino ya no puede ser el ancla genérica de la sección Análisis');
  for (const raw of [
    'agt002::dynamic::decision-question::experiencia',
    'agt002::dynamic::blocker::territorio',
    'req-dyn-experiencia',
    'req-dyn-territorio',
  ]) {
    assert.ok(!dynamicHtml.includes(`href="#${raw}"`), `el ancla nunca puede ser el id gobernado crudo ${raw}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 6b · run_id/snapshot_id quedan exclusivamente bajo un details cuyo summary exacto es
//      «Ver trazabilidad técnica», fuera de la primera capa (dictamen vinculante Task 4 gaps).
// ---------------------------------------------------------------------------------------------
const RUN_DETAILS_PATTERN = /<details class="agt002-v3-run-details">[\s\S]*?<\/details>/;

test('run_id y snapshot_id quedan exclusivamente bajo Ver trazabilidad técnica, fuera de la primera capa', () => {
  for (const [html, fixture] of [[dynamicHtml, DYNAMIC], [pilotHtml, PILOT]]) {
    const match = html.match(RUN_DETAILS_PATTERN);
    assert.ok(match, 'debe existir un details dedicado a la ejecución/snapshot');
    const runBlock = match[0];
    assert.match(runBlock, /^<details class="agt002-v3-run-details">\s*<summary>Ver trazabilidad técnica<\/summary>/, 'el summary exacto debe ser Ver trazabilidad técnica');
    assert.ok(runBlock.includes(fixture.run_id), 'la trazabilidad conserva run_id');
    assert.ok(runBlock.includes(fixture.snapshot_id), 'la trazabilidad conserva snapshot_id');

    const outsideRunBlock = html.replace(RUN_DETAILS_PATTERN, '');
    assert.ok(!outsideRunBlock.includes(fixture.run_id), 'run_id no puede aparecer fuera de la trazabilidad técnica (primera capa)');
    assert.ok(!outsideRunBlock.includes(fixture.snapshot_id), 'snapshot_id no puede aparecer fuera de la trazabilidad técnica (primera capa)');
  }
  assert.ok(!dynamicHtml.includes('Detalles de ejecución'), 'el rótulo anterior Detalles de ejecución ya no debe existir');
});

// ---------------------------------------------------------------------------------------------
// 7 · Invariantes previos de la vista V3 (Task anteriores) sobre el HTML y el fuente.
// ---------------------------------------------------------------------------------------------
test('the view consumes analysis.integral_analysis, never a local fixture array', () => {
  assert.match(source, /analysis\?\.integral_analysis/, 'must read integral_analysis off the real analysis prop');
  assert.match(source, /analysis_units/);
  assert.doesNotMatch(source, /\bconst\s+UNITS\s*[:=]/, 'no local UNITS fixture array');
  assert.doesNotMatch(source, /REQ-DES-001|REQ-HAB-004|REQ-TEC-008|LIC-SYN|Entidad Pública Demo/i, 'no leftover synthetic fixture ids/labels');
});

test('renders nothing when integral_analysis is absent (optional consumption)', () => {
  assert.match(source, /if\s*\(\s*!(?:integral|analysisUnits|units)\b[^)]*\)\s*(?:\{\s*)?return\s+null/s);
  assert.equal(render(null), '');
  assert.equal(render({ run_id: 'r1' }), '');
  assert.equal(render({ integral_analysis: { analysis_units: [] } }), '');
});

test('never hardcodes an institution/expediente name (e.g. Rama Judicial)', () => {
  assert.doesNotMatch(source, /rama\s+judicial/i);
  assert.doesNotMatch(source, /consejo\s+superior/i);
});

test('the institutional five-phase order is closed over the real category enum', () => {
  for (const category of ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic']) {
    assert.match(dynamicHtml, new RegExp(`data-phase="${category}"`), `la fase ${category} se deriva del enum real`);
  }
  assert.match(source, /tenderIntegralPhaseGroups/, 'la agrupación vive en el helper de presentación, no en el componente');
});

test('renders the five independent evidence axes and both commercial/legal readings from real unit fields', () => {
  const { trace } = layers(dynamicHtml);
  for (const axis of ['Presencia', 'Revisión', 'Vigencia', 'Aplicabilidad', 'Sustento']) assert.ok(trace.includes(axis));
  assert.ok(dynamicHtml.includes(DYNAMIC_UNITS[0].commercial_impact.summary));
  assert.ok(trace.includes(DYNAMIC_UNITS[0].legal_assessment.summary));
  assert.ok(dynamicHtml.includes(DYNAMIC_UNITS[1].missing_evidence[0].reason));
});

test('never duplicates the human-question or GO/NO-GO decision surfaces (the human-review disclaimer copy is exempt)', () => {
  assert.doesNotMatch(source, /\bquestions\b/);
  assert.doesNotMatch(source, /<form|onSubmit|\bfetch\s*\(|supabase|\bapi\s*[<(]/);
  assert.doesNotMatch(source, /decidir|autorizar|aprobar/i, 'must never itself offer a GO/NO-GO decision action, only describe it as out of scope');
  assert.doesNotMatch(dynamicHtml, /<form|<textarea|<input/, 'el respaldo técnico nunca es un formulario');
  assert.ok(!dynamicHtml.includes('RATIONALE-INTERNO-EXPERIENCIA'), 'la vista nunca imprime el rationale interno de decision_review');
  assert.ok(!dynamicHtml.includes('ETIQUETA-INTERNA-EXPERIENCIA'), 'la vista nunca imprime la etiqueta interna de decision_review');
});

test('keeps the human-review guard copy visible', () => {
  for (const label of ['Validación humana pendiente', 'No decide GO']) {
    assert.ok(dynamicHtml.includes(label), `la advertencia «${label}» debe seguir visible`);
  }
});

test('css exists and stays generic (no fixture-specific selectors)', () => {
  assert.match(css, /\.agt002-v3-/);
  assert.match(css, /@media/);
});

test('the obsolete synthetic hidden-route preview is fully removed', () => {
  const tendersModuleSource = readFileSync(new URL('src/tenders/TendersModule.tsx', root), 'utf8');
  assert.doesNotMatch(tendersModuleSource, /agt002-v3/);
  assert.doesNotMatch(tendersModuleSource, /TenderAnalysisV3Preview/);
});

test('the real view is wired into the actual tender dossier behind the exact governed summary', () => {
  const mainSource = readFileSync(new URL('src/main.tsx', root), 'utf8');
  const integralViewIndex = mainSource.indexOf('<TenderIntegralAnalysisV3View');
  const analysisSectionIndex = mainSource.indexOf('<TenderAnalysisSection');
  assert.ok(analysisSectionIndex >= 0 && integralViewIndex > analysisSectionIndex, 'the executive question and action surface must render before the technical V3 trace');
  assert.match(mainSource, /<TenderIntegralAnalysisV3View analysis=\{analysis\}/);
  assert.match(mainSource, /<summary>Ver respaldo técnico del análisis<\/summary>/);
  assert.doesNotMatch(mainSource, /Ver análisis técnico completo/);
});
