import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bundleReactModule, loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';
import { runAgt002ManizalesV3LocalRun, AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT } from '../scripts/agt002-manizales-v3-local-run.mjs';

// AGT-002 Task 3 · Análisis es la única superficie completa de condiciones e impedimentos.
// Pruebas conductuales sobre el HTML realmente renderizado (renderToStaticMarkup), no sobre el
// texto fuente: cada entrada gobernada debe existir una sola vez, una entrada sin `presentation`
// debe permanecer con el fallback humano exacto, y el estado visible debe derivarse de la
// respuesta humana más reciente a través de los selectores de Task 2.
// Sin red, sin base de datos, sin commit/push/deploy.

const root = new URL('../', import.meta.url);

const TenderAnalysisSection = await loadReactComponent(
  'src/tenders/components/TenderAnalysisSection.tsx',
  'TenderAnalysisSection',
);
const TenderIntegralAnalysisV3View = await loadReactComponent(
  'src/tenders/components/TenderIntegralAnalysisV3View.tsx',
  'TenderIntegralAnalysisV3View',
);
const TenderDecisionBrief = await loadReactComponent(
  'src/tenders/components/TenderDecisionBrief.tsx',
  'TenderDecisionBrief',
);
const TenderGoNoGoDecisionSummary = await loadReactComponent(
  'src/tenders/components/TenderGoNoGoDecisionSummary.tsx',
  'TenderGoNoGoDecisionSummary',
);

const mainSource = readFileSync(new URL('src/main.tsx', root), 'utf8');
const analysisSource = readFileSync(new URL('src/tenders/components/TenderAnalysisSection.tsx', root), 'utf8');
const cardSource = readFileSync(new URL('src/tenders/components/TenderQuestionResponseCard.tsx', root), 'utf8');
const briefSource = readFileSync(new URL('src/tenders/components/TenderDecisionBrief.tsx', root), 'utf8');
const panelSource = readFileSync(new URL('src/tenders/components/TenderGoNoGoDecisionPanel.tsx', root), 'utf8');

// ---------------------------------------------------------------------------------------------
// Fixture: deliberately NOT the pilot's shape (2 conditions / 1 impediment / 1 supported /
// 2 preparation), so nothing here depends on the pilot's 25/20/5/2 counts.
// ---------------------------------------------------------------------------------------------
const RUN_ID = '7553a51f-e4ca-4ad4-bde8-02528063d178';
const CONDITION_PRESENTED_ID = 'agt002::manizales::decision-question::experiencia';
const CONDITION_UNPRESENTED_ID = 'agt002::manizales::decision-question::sin-presentacion';
const IMPEDIMENT_ID = 'agt002::manizales::blocker::territorialidad';

const CONDITION_PRESENTED = {
  id: CONDITION_PRESENTED_ID,
  requirement_id: 'req-experiencia-especifica',
  label: 'ETIQUETA-INTERNA-EXPERIENCIA',
  reviewed_status: 'decision_question',
  rationale: 'RATIONALE-INTERNO-EXPERIENCIA-NUNCA-VISIBLE',
  evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'req-experiencia-especifica' }],
  presentation: {
    title: 'Certificación de experiencia específica',
    summary: 'La experiencia acreditada aún no cubre el objeto exigido.',
    missing: 'Falta el certificado firmado por el contratante anterior.',
    action_required: 'Solicitar el certificado y registrarlo aquí.',
  },
};

const CONDITION_UNPRESENTED = {
  id: CONDITION_UNPRESENTED_ID,
  requirement_id: 'req-sin-presentacion',
  label: 'ETIQUETA-INTERNA-SIN-PRESENTACION',
  reviewed_status: 'decision_question',
  rationale: 'RATIONALE-INTERNO-SIN-PRESENTACION-NUNCA-VISIBLE',
  evidence_refs: [],
};

const IMPEDIMENT = {
  id: IMPEDIMENT_ID,
  requirement_id: 'req-territorialidad',
  label: 'ETIQUETA-INTERNA-TERRITORIALIDAD',
  reviewed_status: 'blocker',
  rationale: 'RATIONALE-INTERNO-TERRITORIALIDAD-NUNCA-VISIBLE',
  evidence_refs: [],
  presentation: {
    title: 'Domicilio exigido en el municipio',
    summary: 'El pliego exige domicilio en Manizales antes del cierre.',
    missing: 'Falta constancia de domicilio vigente.',
    action_required: 'Confirmar si la sede cumple el requisito territorial.',
  },
};

const SUPPORTED = {
  id: 'agt002::manizales::supported::capacidad',
  requirement_id: 'req-capacidad-financiera',
  label: 'ETIQUETA-INTERNA-CAPACIDAD',
  reviewed_status: 'supported',
  rationale: 'RATIONALE-INTERNO-CAPACIDAD-NUNCA-VISIBLE',
  evidence_refs: [],
  presentation: {
    title: 'Capacidad financiera acreditada',
    summary: 'Los indicadores financieros superan el umbral del pliego.',
  },
};

const PREPARATION_PRESENTED = {
  id: 'agt002::manizales::preparation::poliza',
  requirement_id: 'req-poliza',
  label: 'ETIQUETA-INTERNA-POLIZA',
  reviewed_status: 'preparation',
  rationale: 'RATIONALE-INTERNO-POLIZA-NUNCA-VISIBLE',
  evidence_refs: [],
  presentation: {
    title: 'Póliza de seriedad de la oferta',
    summary: 'Trámite estándar previo al cierre.',
    action_required: 'Cotizar la póliza con la aseguradora habitual.',
  },
};

const PREPARATION_UNPRESENTED = {
  id: 'agt002::manizales::preparation::sin-presentacion',
  requirement_id: 'req-preparacion-sin-presentacion',
  label: 'ETIQUETA-INTERNA-PREPARACION',
  reviewed_status: 'preparation',
  rationale: 'RATIONALE-INTERNO-PREPARACION-NUNCA-VISIBLE',
  evidence_refs: [],
};

const DECISION_REVIEW = {
  artifact_type: 'tender_decision_review',
  contract_version: 'agt002.decision_review.v1',
  source_fixture_version: 1,
  opportunity_id: '54190e51-15fb-46af-b0aa-8f13461a3110',
  human_approval_required: true,
  decision_status: 'pending_human_decision',
  decision_ready: false,
  routing_action: 'flag_for_responsible_person',
  external_communications_allowed: false,
  evidence_requests_allowed: true,
  review_findings: [],
  exercise_mode: { active: true, bypassed_requirement_ids: [] },
  recommendation: 'pending_human_decision',
  blockers: [IMPEDIMENT],
  decision_questions: [CONDITION_PRESENTED, CONDITION_UNPRESENTED],
  supported: [SUPPORTED],
  preparation: [PREPARATION_PRESENTED, PREPARATION_UNPRESENTED],
  not_applicable: [],
  counts: { supported: 1, preparation: 2, not_applicable: 0, decision_questions: 2, blockers: 1 },
};

// Unidad V3 mínima pero completa (todos los campos gobernados del contrato), para poder montar
// TenderIntegralAnalysisV3View sobre el mismo fixture que Análisis y probar el ancla compartida.
function integralUnit({ unit_id, requirement_id, title, sequence, category = 'habilitating', missing_evidence = [] }) {
  return {
    unit_id,
    unit_kind: 'tender_requirement',
    requirement_id,
    category,
    sequence,
    title,
    assessment_mode: 'assessed',
    conclusion: { status: 'supported_with_evidence', summary: 'Sustento verificado en el expediente.', confidence: 'high' },
    blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto bloqueante.' },
    evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
    evidence_refs: [],
    missing_evidence,
    commercial_impact: { level: 'low', summary: 'Sin impacto comercial relevante.', dimension: 'none' },
    legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Sin verificación legal registrada.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_applicable', type: 'not_applicable', at: null, source_ref: null, summary: 'Sin hito asociado.' },
    escalation: { required: false, level: 'none', reason: 'Sin escalamiento requerido.' },
    closure: { status: 'open', condition: 'sin condición', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Pendiente de validación humana.' },
  };
}

// Toda corrida V3 real trae el inventario gobernado del expediente vigente dentro de
// evidence_coverage (AGT002_INTEGRAL_CONTRACT_V3 exige AGT002_DOCUMENT_RETRIEVAL). El respaldo
// V3 y la superficie de Análisis sólo rinden completo cuando ese inventario está bien formado y
// `decision_ready === true`; este fixture representa ese único caso listo. El contrato P0 real
// (`buildTenderRequirementInventory`) fija hoy `decision_ready: false`/`recommendation: 'pause'`
// en toda corrida — ese caso pausado, distinto de éste, se prueba explícitamente más abajo.
const READY_EVIDENCE_COVERAGE = Object.freeze({
  tender_requirement_inventory: Object.freeze({
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: true,
    recommendation: 'proceed_to_analysis',
    human_review_required: true,
    expedient_coverage: { status: 'complete', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
    analyzed_coverage: { status: 'complete', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
  }),
});
// Forma real del contrato P0 vigente: inventario presente y bien formado, pero con
// `decision_ready: false` — el valor que fija toda corrida real hoy. Debe seguir pausada.
const PAUSED_EVIDENCE_COVERAGE = Object.freeze({
  tender_requirement_inventory: Object.freeze({
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: false,
    recommendation: 'pause',
    human_review_required: true,
    expedient_coverage: { status: 'partial', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
    analyzed_coverage: { status: 'incomplete', total_source_units: 9, dispositioned_source_units: 0, requirement_count: 0 },
  }),
});

const ANALYSIS = {
  run_id: RUN_ID,
  snapshot_id: 'snap-task3',
  evidence_coverage: READY_EVIDENCE_COVERAGE,
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  current: true,
  critical_open_count: 0,
  integral_analysis: {
    contract_version: 'test@1',
    coverage: {
      manifest_version: 'test@1',
      expected_requirement_ids: ['req-experiencia-especifica', 'req-territorialidad'],
      analyzed_requirement_ids: ['req-experiencia-especifica', 'req-territorialidad'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'test@1',
      company_evidence_class_ids: [],
      legal_corpus_version_id: null,
    },
    analysis_units: [
      integralUnit({ unit_id: 'u1', requirement_id: 'req-experiencia-especifica', title: 'Unidad técnica 1', sequence: 1 }),
      integralUnit({ unit_id: 'u2', requirement_id: 'req-territorialidad', title: 'Unidad técnica 2', sequence: 2 }),
    ],
  },
  decision_review: DECISION_REVIEW,
};

// Misma corrida V3, pero con la forma real del contrato P0 vigente (inventario presente, bien
// formado, `decision_ready: false`). Debe pausar en ambas superficies, no rendir el V3 completo.
const PAUSED_ANALYSIS = { ...ANALYSIS, evidence_coverage: PAUSED_EVIDENCE_COVERAGE };
// Misma corrida V3, pero sin ningún inventario en absoluto (histórico previo al contrato de
// inventario). También debe pausar en ambas superficies.
const NO_INVENTORY_ANALYSIS = { ...ANALYSIS, evidence_coverage: undefined };

const DOCUMENTS = [{
  id: 'doc-1',
  name: 'pliego.pdf',
  size: 1024,
  document_type: 'pliego',
  current: true,
  uploaded_at: '2026-08-01T10:00:00.000Z',
}];

function responseFor(questionId, status, overrides = {}) {
  return {
    id: `resp-${questionId}-${status}`,
    opportunity_id: DECISION_REVIEW.opportunity_id,
    analysis_run_id: RUN_ID,
    question_id: questionId,
    question_text: 'texto persistido de la pregunta',
    status,
    response: `Respuesta humana registrada (${status}).`,
    responded_by: 'profile-1',
    responded_by_name: 'Encargada de Licitaciones',
    responded_at: '2026-08-10T15:00:00.000Z',
    attachments: [],
    ...overrides,
  };
}

function render(overrides = {}) {
  return renderToStaticMarkup(createElement(TenderAnalysisSection, {
    analysis: ANALYSIS,
    documents: DOCUMENTS,
    busy: false,
    canRunPreview: true,
    onAnalyzePreview: () => {},
    questionResponses: [],
    canAnswerQuestions: true,
    onSaveQuestionResponse: async () => {},
    ...overrides,
  }));
}

const countOf = (haystack, needle) => haystack.split(needle).length - 1;
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Task 7.1 · Extrae el fragmento <article>…</article> de una tarjeta operativa localizándola por
// su título, para poder afirmar sobre esa tarjeta sola sin que otras tarjetas legítimamente
// pendientes contaminen los asserts globales sobre el HTML completo.
function extractCardByTitle(html, title) {
  const titleIndex = html.indexOf(title);
  assert.ok(titleIndex >= 0, `el título «${title}» debe existir en el HTML`);
  const articleStart = html.lastIndexOf('<article', titleIndex);
  assert.ok(articleStart >= 0, `debe existir una <article> antes del título «${title}»`);
  const articleEndTagIndex = html.indexOf('</article>', titleIndex);
  assert.ok(articleEndTagIndex >= 0, `debe existir un cierre </article> después del título «${title}»`);
  const articleEnd = articleEndTagIndex + '</article>'.length;
  return html.slice(articleStart, articleEnd);
}

// ---------------------------------------------------------------------------------------------
// 1 · Una tarjeta por cada condición y cada impedimento — exactamente una vez.
// ---------------------------------------------------------------------------------------------
test('cada condición y cada impedimento gobernado se renderiza exactamente una vez', () => {
  const html = render();
  assert.equal(
    countOf(html, 'tender-question-response-card'),
    DECISION_REVIEW.decision_questions.length + DECISION_REVIEW.blockers.length,
    'Análisis debe rendir una tarjeta operativa por cada condición y cada impedimento gobernado',
  );
  assert.equal(countOf(html, CONDITION_PRESENTED.presentation.title), 1, 'la condición con presentación aparece una sola vez');
  assert.equal(countOf(html, IMPEDIMENT.presentation.title), 1, 'el impedimento aparece una sola vez');
  assert.equal(countOf(html, CONDITION_PRESENTED.presentation.missing), 1);
  assert.equal(countOf(html, CONDITION_PRESENTED.presentation.action_required), 1);
});

// ---------------------------------------------------------------------------------------------
// 2 · Una condición sin `presentation` permanece visible con el fallback humano exacto.
// ---------------------------------------------------------------------------------------------
test('una condición sin presentación no desaparece y usa el fallback humano exacto', () => {
  const html = render();
  assert.ok(html.includes('Clasificación ejecutiva no disponible'), 'el fallback humano debe estar presente');
  assert.ok(html.includes('Revisar el respaldo técnico gobernado de esta condición.'), 'el fallback debe indicar qué falta');
  assert.ok(html.includes('Completar la presentación humana antes de cerrar la validación.'), 'el fallback debe indicar la acción requerida');
  assert.ok(!html.includes('RATIONALE-INTERNO-SIN-PRESENTACION-NUNCA-VISIBLE'), 'el fallback nunca puede degradar a rationale');
});

// ---------------------------------------------------------------------------------------------
// 3 · El estado visible cambia con la respuesta humana más reciente (pending → resolved).
// ---------------------------------------------------------------------------------------------
test('cambiar la última respuesta de pending a resolved cambia el badge a Validación registrada', () => {
  const pendingHtml = render({ questionResponses: [responseFor(CONDITION_PRESENTED_ID, 'pending')] });
  assert.ok(pendingHtml.includes('Pendiente de validación'), 'una respuesta pendiente mantiene el estado pendiente');
  assert.ok(!pendingHtml.includes('Validación registrada'), 'una respuesta pendiente no puede leerse como validada');

  const resolvedHtml = render({
    questionResponses: [
      // Desordenadas a propósito: gana la más reciente por responded_at, no el orden del arreglo.
      responseFor(CONDITION_PRESENTED_ID, 'resolved', { id: 'resp-nueva', responded_at: '2026-08-12T09:00:00.000Z' }),
      responseFor(CONDITION_PRESENTED_ID, 'pending', { id: 'resp-vieja', responded_at: '2026-08-10T15:00:00.000Z' }),
    ],
  });
  assert.ok(resolvedHtml.includes('Validación registrada'), 'la respuesta más reciente resuelta debe mostrarse como validación registrada');
});

// ---------------------------------------------------------------------------------------------
// 3b · Sin ninguna respuesta humana registrada, la condición muestra el mismo badge Pendiente de
//      validación que una respuesta explícita en estado pending (el default no es un estado
//      distinto ni un fallback silencioso).
// ---------------------------------------------------------------------------------------------
test('una condición sin ninguna respuesta humana registrada muestra Pendiente de validación', () => {
  const html = render({ questionResponses: [] });
  assert.ok(html.includes('Pendiente de validación'), 'sin respuesta la condición debe leerse como pendiente de validación');
  assert.ok(!html.includes('Validación registrada'), 'sin respuesta nunca puede leerse como validada');
  assert.ok(!html.includes('No aplica'), 'sin respuesta nunca puede leerse como no aplica');
});

// ---------------------------------------------------------------------------------------------
// 3c · La respuesta humana más reciente en estado not_applicable cambia el badge a No aplica.
// ---------------------------------------------------------------------------------------------
test('una respuesta humana en estado not_applicable cambia el badge de la condición a No aplica', () => {
  const html = render({ questionResponses: [responseFor(CONDITION_PRESENTED_ID, 'not_applicable')] });
  const card = extractCardByTitle(html, CONDITION_PRESENTED.presentation.title);
  assert.ok(card.includes('No aplica'), 'la respuesta not_applicable debe mostrarse como No aplica');
  assert.ok(!card.includes('Pendiente de validación'), 'not_applicable no puede leerse como pendiente');
  assert.ok(!card.includes('Validación registrada'), 'not_applicable no puede leerse como validación registrada');
});

// ---------------------------------------------------------------------------------------------
// 4 · Antes del formulario sólo Condición / Estado / Qué falta / Acción requerida.
// ---------------------------------------------------------------------------------------------
test('la tarjeta operativa muestra sólo los cuatro campos decisores antes del formulario', () => {
  const html = render();
  for (const label of ['Condición', 'Estado', 'Qué falta', 'Acción requerida']) {
    assert.ok(html.includes(label), `debe rotular ${label}`);
  }
  for (const banned of [
    'RATIONALE-INTERNO-EXPERIENCIA-NUNCA-VISIBLE',
    'RATIONALE-INTERNO-TERRITORIALIDAD-NUNCA-VISIBLE',
    'ETIQUETA-INTERNA-EXPERIENCIA',
    CONDITION_PRESENTED_ID,
    IMPEDIMENT_ID,
    'req-experiencia-especifica',
    'Alerta material',
    'Aún no hay respuesta humana',
    'Ver evidencia',
  ]) {
    assert.ok(!html.includes(banned), `el HTML renderizado nunca debe contener «${banned}»`);
  }
  assert.ok(!analysisSource.includes('TenderFindingEvidence'), 'la tarjeta operativa ya no monta evidencia técnica');
});

// ---------------------------------------------------------------------------------------------
// 5 · Acciones renombradas: Registrar validación / Actualizar validación.
// ---------------------------------------------------------------------------------------------
test('el botón dice Registrar validación sin respuesta y Actualizar validación con respuesta vigente', () => {
  const empty = render();
  assert.ok(empty.includes('Registrar validación'), 'sin respuesta vigente la acción es Registrar validación');
  assert.ok(!empty.includes('Actualizar validación'), 'sin respuesta vigente no se ofrece actualizar');

  const answered = render({ questionResponses: [responseFor(CONDITION_PRESENTED_ID, 'resolved')] });
  assert.ok(answered.includes('Actualizar validación'), 'con respuesta vigente la acción es Actualizar validación');
});

// ---------------------------------------------------------------------------------------------
// 6 · Persistencia intacta: respuesta vigente, adjuntos, autor, fecha e historial.
// ---------------------------------------------------------------------------------------------
test('se conservan respuesta vigente, adjuntos, autor, fecha e historial', () => {
  const html = render({
    questionResponses: [
      responseFor(CONDITION_PRESENTED_ID, 'pending', {
        id: 'resp-historica',
        response: 'Primera respuesta histórica.',
        responded_at: '2026-08-05T12:00:00.000Z',
      }),
      responseFor(CONDITION_PRESENTED_ID, 'resolved', {
        id: 'resp-vigente',
        response: 'Respuesta vigente con soporte.',
        responded_at: '2026-08-12T09:00:00.000Z',
        attachments: [{
          id: 'att-1',
          name: 'certificado-experiencia.pdf',
          mime_type: 'application/pdf',
          size_bytes: 2048,
          uploaded_by: 'profile-1',
          uploaded_at: '2026-08-12T09:00:00.000Z',
          signed_url: 'https://example.invalid/signed/certificado',
        }],
      }),
    ],
  });
  assert.ok(html.includes('Respuesta vigente con soporte.'), 'la respuesta vigente se conserva');
  assert.ok(html.includes('certificado-experiencia.pdf'), 'los adjuntos se conservan');
  assert.ok(html.includes('https://example.invalid/signed/certificado'), 'el enlace firmado se conserva');
  assert.ok(html.includes('Encargada de Licitaciones'), 'el autor se conserva');
  assert.ok(/\d{4}/.test(html) && html.includes('Historial de respuestas (2)'), 'la fecha y el historial se conservan');
  assert.ok(html.includes('Primera respuesta histórica.'), 'el historial conserva las respuestas previas');
  // La persistencia sigue anclada al id/texto de la pregunta, no a la copia decisora.
  assert.ok(cardSource.includes('question_id: question.id'), 'question.id sigue siendo la llave de persistencia');
  assert.ok(cardSource.includes('question_text: question.text'), 'question.text sigue siendo el texto persistido');
  assert.ok(analysisSource.includes('text: card.persistence.questionText'), 'question.text debe conservar la etiqueta gobernada encapsulada por el selector');
  assert.ok(!analysisSource.includes('decision_review?.decision_questions'), 'el componente no debe volver a leer arrays crudos para persistencia');
  assert.ok(/decisionCopy/.test(cardSource), 'NormalizedQuestion debe llevar la copia decisora separada');
});

// ---------------------------------------------------------------------------------------------
// 7 · Bloques compactos dentro de Análisis, con fallback humano.
// ---------------------------------------------------------------------------------------------
test('Análisis incluye Aspectos favorables y capacidad y Acciones de preparación desde los selectores', () => {
  const html = render();
  assert.ok(html.includes('Aspectos favorables y capacidad'), 'debe existir el bloque compacto de aspectos favorables');
  assert.ok(html.includes('Acciones de preparación'), 'debe existir el bloque compacto de acciones de preparación');
  assert.equal(countOf(html, SUPPORTED.presentation.title), 1);
  assert.equal(countOf(html, PREPARATION_PRESENTED.presentation.title), 1);
  assert.ok(!html.includes('RATIONALE-INTERNO-CAPACIDAD-NUNCA-VISIBLE'));
  assert.ok(!html.includes('RATIONALE-INTERNO-POLIZA-NUNCA-VISIBLE'));
  assert.ok(!html.includes('RATIONALE-INTERNO-PREPARACION-NUNCA-VISIBLE'));
  // Una condición sin presentación y una preparación sin presentación → dos fallbacks exactos.
  assert.equal(countOf(html, 'Clasificación ejecutiva no disponible'), 2, 'cada entrada sin presentación conserva su fallback');
  // Los bloques compactos no son formularios respondibles.
  assert.equal(countOf(html, 'tender-question-response-card'), 3, 'supported/preparation nunca se vuelven tarjetas respondibles');
});

// ---------------------------------------------------------------------------------------------
// 8 · Sin proyección duplicada: Análisis consume los selectores de Task 2.
// ---------------------------------------------------------------------------------------------
test('Análisis consume tenderDecisionSurface y no vuelve a proyectar decision_review', () => {
  assert.ok(analysisSource.includes("from '../tenderDecisionSurface'"), 'debe importar los selectores de Task 2');
  for (const selector of [
    'tenderDecisionConditions',
    'tenderDecisionBlockers',
    'tenderDecisionSupportedAspects',
    'tenderDecisionPreparationActions',
  ]) {
    assert.ok(analysisSource.includes(selector), `debe consumir ${selector}`);
  }
  assert.ok(!/decision_review\.decision_questions\s*\|\|/.test(analysisSource), 'no debe volver a proyectar decision_questions localmente');
  assert.ok(!analysisSource.includes('entry.rationale'), 'no debe transportar rationale a la capa de presentación');
});

// ---------------------------------------------------------------------------------------------
// 9 · Documentos y Análisis son secciones hermanas; un solo id="tender-analysis".
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// 10 · Task 4 · el respaldo técnico V3 vive en Análisis, detrás del resumen exterior exacto.
// ---------------------------------------------------------------------------------------------
test('el contenedor del respaldo técnico usa exactamente <summary>Ver respaldo técnico del análisis</summary>', () => {
  assert.match(
    mainSource,
    /<details id="tender-technical-analysis" className="tender-integral-analysis-trace"><summary>Ver respaldo técnico del análisis<\/summary><TenderIntegralAnalysisV3View analysis=\{analysis\} \/><\/details>/,
    'el contenedor exterior debe conservar su id/clase y el texto exacto del contrato',
  );
  assert.equal(countOf(mainSource, '<summary>Ver respaldo técnico del análisis</summary>'), 1, 'el resumen exterior existe una sola vez');
  assert.equal(countOf(mainSource, '<TenderIntegralAnalysisV3View'), 1, 'la vista V3 se monta una sola vez');
});

test('el respaldo técnico permanece dentro de Análisis: nunca en Documentos ni montado desde Decisión', () => {
  const analysisIndex = mainSource.indexOf('id="tender-analysis"');
  const traceIndex = mainSource.indexOf('id="tender-technical-analysis"');
  const documentsIndex = mainSource.indexOf('id="tender-document-review"');
  assert.ok(traceIndex > analysisIndex, 'el respaldo técnico se declara dentro de la sección Análisis');
  assert.ok(traceIndex > documentsIndex, 'el respaldo técnico no vive en Documentos');
  const documentsBlock = mainSource.slice(documentsIndex, analysisIndex);
  assert.ok(!documentsBlock.includes('TenderIntegralAnalysisV3View'), 'Documentos nunca monta la vista V3');

  const briefSource = readFileSync(new URL('src/tenders/components/TenderDecisionBrief.tsx', root), 'utf8');
  const goNoGoSource = readFileSync(new URL('src/tenders/components/TenderGoNoGoDecisionPanel.tsx', root), 'utf8');
  for (const decisionSource of [briefSource, goNoGoSource]) {
    assert.ok(!decisionSource.includes('TenderIntegralAnalysisV3View'), 'Decisión nunca monta ni enlaza la vista V3 por componente');
  }
});

// ---------------------------------------------------------------------------------------------
// 11 · GAP1 (dictamen vinculante Task 4) · la tarjeta de una condición/impedimento expone el
//      ancla gobernada, opaca y no técnica que V3 usa para enlazar — misma función pura, sin
//      duplicar la relación por texto ni exponer el id gobernado crudo.
// ---------------------------------------------------------------------------------------------
test('cada tarjeta gobernada expone su ancla opaca (tender-condition-N) sin imprimir el id gobernado crudo', () => {
  const html = render();
  // Orden estable decision_questions+blockers: CONDITION_PRESENTED(1), CONDITION_UNPRESENTED(2), IMPEDIMENT(3).
  assert.ok(html.includes('id="tender-condition-1"'), 'la condición presentada expone su ancla opaca');
  assert.ok(html.includes('id="tender-condition-3"'), 'el impedimento (tercero en el orden estable) expone su ancla opaca');
  assert.ok(!html.includes(`id="${CONDITION_PRESENTED_ID}"`), 'el id gobernado crudo nunca es el atributo id de la tarjeta');
  assert.ok(!html.includes(`id="${IMPEDIMENT_ID}"`), 'el id gobernado crudo nunca es el atributo id de la tarjeta');
});

test('el href de Ver condición principal en V3 apunta a un id que existe realmente en la superficie de Análisis', () => {
  const analysisHtml = render();
  const v3Html = renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: ANALYSIS }));
  const anchors = [...v3Html.matchAll(/href="#(tender-condition-\d+)"/g)].map(match => match[1]);
  assert.ok(anchors.length > 0, 'el fixture compartido debe producir al menos un enlace de condición principal');
  for (const anchor of anchors) {
    assert.ok(analysisHtml.includes(`id="${anchor}"`), `el ancla ${anchor} debe existir como id real en la superficie de Análisis`);
  }
});

// ---------------------------------------------------------------------------------------------
// 11e · Contrato fail-closed AGT-002 (revisado por AGT-002-002). El gate de cobertura sigue siendo
//      UNO solo y compartido, pero las dos superficies no se comportan igual ante él:
//        · TenderAnalysisSection es la superficie de DECISIÓN y permanece pausada sin excepción:
//          ninguna condición, impedimento, cobertura, conteo, fase ni recomendación se filtra.
//        · TenderIntegralAnalysisV3View es el RESPALDO TÉCNICO y deja de repetir esa pausa —al
//          repetirla, dos expedientes distintos rendían exactamente la misma pantalla—. Conserva el
//          análisis realmente guardado de ese expediente como respaldo histórico / solo
//          trazabilidad, sin ninguna derivación agregada legible como cobertura integral vigente.
// ---------------------------------------------------------------------------------------------
const HISTORICAL_TITLE = 'Respaldo técnico histórico · solo trazabilidad';

function assertPausedDecisionSurface(analysisHtml, caso) {
  assert.ok(analysisHtml.includes('Análisis integral pausado'), `Análisis debe mostrar el aviso de pausa (${caso})`);
  assert.equal(analysisHtml.includes(CONDITION_PRESENTED.presentation.title), false, `ninguna condición gobernada puede filtrarse en pausa (${caso})`);
  assert.equal(analysisHtml.includes(IMPEDIMENT.presentation.title), false, `ningún impedimento gobernado puede filtrarse en pausa (${caso})`);
  assert.equal(analysisHtml.includes('Unidad técnica 1'), false, `ninguna unidad V3 puede filtrarse a la decisión (${caso})`);
  assert.equal(analysisHtml.includes('Requisitos analizados'), false, `ningún conteo de cobertura integral puede filtrarse (${caso})`);
}

function assertHistoricalBackup(v3Html, caso) {
  assert.ok(v3Html.includes(HISTORICAL_TITLE), `el respaldo técnico debe rotularse como histórico (${caso})`);
  assert.match(v3Html, /no es una recomendaci[oó]n integral vigente/i, `debe negar ser una recomendación integral vigente (${caso})`);
  assert.ok(v3Html.includes('No decide GO / NO GO'), `nunca puede insinuar GO (${caso})`);
  // La trazabilidad de ESE expediente sí se conserva: es justamente lo que la pausa repetida borraba.
  assert.ok(v3Html.includes('Unidad técnica 1'), `la unidad conservada de este expediente debe seguir visible (${caso})`);
  assert.ok(v3Html.includes('Unidad técnica 2'), `la unidad conservada de este expediente debe seguir visible (${caso})`);
  // Pero ninguna lectura agregada que pueda confundirse con cobertura integral vigente.
  assert.equal(v3Html.includes('Cobertura integral no disponible'), false, `ya no repite el aviso de pausa de la decisión (${caso})`);
  assert.equal(v3Html.includes('Análisis integral por requisito'), false, `nunca se presenta como el análisis integral vigente (${caso})`);
  assert.equal(v3Html.includes('Requisitos analizados'), false, `ningún conteo de cobertura integral puede filtrarse (${caso})`);
  assert.equal(v3Html.includes(CONDITION_PRESENTED.presentation.title), false, `el respaldo técnico nunca proyecta condiciones gobernadas (${caso})`);
  assert.equal(/href="#tender-condition-\d+"/.test(v3Html), false, `ningún ancla puede quedar colgando hacia una decisión pausada (${caso})`);
}

test('inventario presente con decision_ready=false pausa la decisión y conserva el respaldo técnico como trazabilidad histórica', () => {
  assertPausedDecisionSurface(render({ analysis: PAUSED_ANALYSIS }), 'decision_ready=false');
  assertHistoricalBackup(renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: PAUSED_ANALYSIS })), 'decision_ready=false');
});

test('V3 histórico sin ningún inventario pausa la decisión y conserva el respaldo técnico como trazabilidad histórica', () => {
  assertPausedDecisionSurface(render({ analysis: NO_INVENTORY_ANALYSIS }), 'sin inventario');
  assertHistoricalBackup(renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: NO_INVENTORY_ANALYSIS })), 'sin inventario');
});

test('inventario listo (decision_ready === true) rinde el V3 completo y las condiciones en Análisis, en el mismo fixture', () => {
  const analysisHtml = render();
  const v3Html = renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: ANALYSIS }));

  assert.equal(analysisHtml.includes('Análisis integral pausado'), false);
  assert.equal(v3Html.includes(HISTORICAL_TITLE), false, 'con cobertura lista el respaldo nunca se rotula como histórico');
  assert.ok(v3Html.includes('Análisis integral por requisito'), 'con cobertura lista se rinde la lectura integral vigente');
  assert.ok(analysisHtml.includes(CONDITION_PRESENTED.presentation.title), 'Análisis debe rendir la condición gobernada');
  assert.ok(v3Html.includes('Unidad técnica 1'), 'V3 debe rendir la unidad gobernada');
});

// ---------------------------------------------------------------------------------------------
// 11f · El gate compartido es consciente de la COBERTURA de evidencia completa, no sólo del
//      inventario legado. `evidence_coverage.tender_semantic_manifest` es la frontera semántica
//      vigente del expediente: un manifiesto finalizado y gobernado (versión
//      `tender_semantic_manifest.v1`, `decision_ready: true`, `discovery_coverage` completa y
//      `analyzed_coverage` completa) ES la cobertura integral, y el inventario legado —fijado hoy
//      por el contrato P0 en `decision_ready: false` en toda corrida real— ya no puede pausarla.
//      Al revés, un manifiesto presente pero no listo pausa aunque el inventario legado se
//      declare listo. Las dos superficies deben coincidir siempre, porque comparten el mismo
//      selector puro sobre `evidence_coverage`.
// ---------------------------------------------------------------------------------------------
const sha256Like = char => char.repeat(64);
function semanticManifest(overrides = {}) {
  const requirements = ANALYSIS.integral_analysis.analysis_units.map((unit, index) => ({
    requirement_id: unit.requirement_id,
    obligation_key: `obligacion-gobernada-${index + 1}`,
    kind: 'obligation',
    label: `Obligación gobernada ${index + 1}`,
    front: 'legal',
    front_evidence: { source_unit_id: `su-${index + 1}`, unit_hash: sha256Like('a') },
    citations: [{ source_unit_id: `su-${index + 1}`, unit_hash: sha256Like('a') }],
    supplemental_signal_ids: [],
  }));
  const total = requirements.length;
  return {
    semantic_manifest_version: 'tender_semantic_manifest.v1',
    snapshot_id: 'snap-task3',
    snapshot_hash: sha256Like('b'),
    inventory_hash: sha256Like('c'),
    origin: 'model_proposal',
    proposal_hash: null,
    requirements,
    excluded: [],
    unresolved: [],
    coverage_ledger: {
      total_source_units: total,
      cited_count: total,
      excluded_count: 0,
      unresolved_count: 0,
      every_source_unit_disposed: true,
    },
    discovery_coverage: { status: 'complete', total_source_units: total, dispositioned_source_units: total, requirement_count: total },
    analyzed_coverage: { status: 'complete', total_source_units: total, dispositioned_source_units: total, requirement_count: total },
    decision_ready: true,
    recommendation: 'ready_for_human_review',
    human_review_required: true,
    semantic_manifest_hash: sha256Like('d'),
    ...overrides,
  };
}

// Frontera semántica lista sobre el inventario legado PAUSADO (la forma real de una corrida
// semántica hoy): debe rendir completo en las dos superficies.
const SEMANTIC_READY_ANALYSIS = {
  ...ANALYSIS,
  evidence_coverage: { ...PAUSED_EVIDENCE_COVERAGE, tender_semantic_manifest: semanticManifest() },
};
// Frontera semántica NO lista sobre el inventario legado LISTO: debe pausar en las dos.
const SEMANTIC_PAUSED_ANALYSIS = {
  ...ANALYSIS,
  evidence_coverage: {
    ...READY_EVIDENCE_COVERAGE,
    tender_semantic_manifest: semanticManifest({ decision_ready: false, recommendation: 'pause' }),
  },
};
const SEMANTIC_PARTIAL_ANALYSIS = {
  ...ANALYSIS,
  evidence_coverage: {
    ...READY_EVIDENCE_COVERAGE,
    tender_semantic_manifest: semanticManifest({
      discovery_coverage: { status: 'partial', total_source_units: 2, dispositioned_source_units: 1, requirement_count: 2 },
      analyzed_coverage: { status: 'incomplete', total_source_units: 2, dispositioned_source_units: 0, requirement_count: 0 },
    }),
  },
};

// El gate es UNA sola función pura compartida por las dos superficies, y su entrada es toda la
// cobertura de evidencia (`analysis.evidence_coverage`), no sólo el inventario legado.
const { tenderAnalysisCoverageReady } = await bundleReactModule('src/tenders/tenderIntegralAnalysisPresentation.ts');

test('tenderAnalysisCoverageReady decide sobre toda la cobertura de evidencia: manifiesto semántico primero, inventario legado como respaldo', () => {
  assert.equal(typeof tenderAnalysisCoverageReady, 'function', 'el gate compartido debe existir como selector puro exportado');

  // Frontera semántica finalizada y lista: manda sobre el inventario legado pausado.
  assert.equal(tenderAnalysisCoverageReady(SEMANTIC_READY_ANALYSIS.evidence_coverage), true);
  // Frontera semántica presente pero no lista: manda sobre el inventario legado listo.
  assert.equal(tenderAnalysisCoverageReady(SEMANTIC_PAUSED_ANALYSIS.evidence_coverage), false);
  assert.equal(tenderAnalysisCoverageReady(SEMANTIC_PARTIAL_ANALYSIS.evidence_coverage), false);
  // Sin frontera semántica: exactamente la lectura legada del inventario.
  assert.equal(tenderAnalysisCoverageReady(READY_EVIDENCE_COVERAGE), true);
  assert.equal(tenderAnalysisCoverageReady(PAUSED_EVIDENCE_COVERAGE), false);
  // Fail-closed ante cualquier cobertura ausente o sin forma gobernada.
  for (const empty of [null, undefined, {}, [], 'complete']) {
    assert.equal(tenderAnalysisCoverageReady(empty), false, `una cobertura sin forma gobernada nunca está lista: ${JSON.stringify(empty)}`);
  }
});

test('un manifiesto semántico finalizado y listo rinde el análisis integral completo en Análisis y en V3, aunque el inventario legado siga pausado', () => {
  const analysisHtml = render({ analysis: SEMANTIC_READY_ANALYSIS });
  const v3Html = renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: SEMANTIC_READY_ANALYSIS }));

  assert.equal(analysisHtml.includes('Análisis integral pausado'), false, 'con cobertura semántica lista Análisis no puede seguir pausado');
  assert.equal(v3Html.includes(HISTORICAL_TITLE), false, 'con cobertura semántica lista V3 no puede degradar a respaldo histórico');
  assert.ok(analysisHtml.includes(CONDITION_PRESENTED.presentation.title), 'Análisis debe rendir la condición gobernada');
  assert.ok(analysisHtml.includes(IMPEDIMENT.presentation.title), 'Análisis debe rendir el impedimento gobernado');
  assert.ok(v3Html.includes('Unidad técnica 1'), 'V3 debe rendir la unidad gobernada');
  assert.ok(v3Html.includes('Requisitos analizados'), 'V3 debe rendir la cobertura integral');
});

test('un manifiesto semántico con decision_ready=false o cobertura parcial pausa la decisión y degrada V3 a trazabilidad histórica, aunque el inventario legado se declare listo', () => {
  for (const [caso, analysis] of [
    ['decision_ready=false', SEMANTIC_PAUSED_ANALYSIS],
    ['cobertura parcial/incompleta', SEMANTIC_PARTIAL_ANALYSIS],
  ]) {
    assertPausedDecisionSurface(render({ analysis }), caso);
    assertHistoricalBackup(renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis })), caso);
  }
});

test('sin manifiesto semántico ambas superficies conservan la lectura legada del inventario', () => {
  // Legado listo → lectura integral completa en las dos (mismo fixture que el resto del archivo).
  assert.equal(ANALYSIS.evidence_coverage.tender_semantic_manifest, undefined, 'el fixture legado no anuncia frontera semántica');
  assert.equal(render().includes('Análisis integral pausado'), false);
  assert.equal(
    renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: ANALYSIS })).includes(HISTORICAL_TITLE),
    false,
  );

  // Legado no listo → decisión pausada y respaldo técnico degradado a trazabilidad histórica.
  assertPausedDecisionSurface(render({ analysis: PAUSED_ANALYSIS }), 'legado no listo');
  assertHistoricalBackup(renderToStaticMarkup(createElement(TenderIntegralAnalysisV3View, { analysis: PAUSED_ANALYSIS })), 'legado no listo');
});

// ---------------------------------------------------------------------------------------------
// 11b · V3 con la cantidad real del piloto (AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT
//      unidades) — HTML renderizado real de una corrida completa del motor, no un fixture de
//      prueba. Prueba que TenderIntegralAnalysisV3View no está atado a los 2 unidades del fixture
//      compartido de este archivo.
// ---------------------------------------------------------------------------------------------
test('TenderIntegralAnalysisV3View renderiza el HTML real con la cantidad de unidades del piloto', async () => {
  const { envelope } = await runAgt002ManizalesV3LocalRun();
  const pilotUnits = envelope.integral_analysis.analysis_units;
  assert.equal(pilotUnits.length, AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT, 'el fixture del piloto debe seguir teniendo la cantidad gobernada esperada');

  const html = renderReactComponent(TenderIntegralAnalysisV3View, {
    analysis: { run_id: 'pilot-run', snapshot_id: 'pilot-snapshot', evidence_coverage: READY_EVIDENCE_COVERAGE, integral_analysis: envelope.integral_analysis, decision_review: null },
  });
  assert.ok(html.includes(`<dd>${AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT}</dd>`), 'el resumen renderizado debe mostrar el total real de unidades del piloto');
  for (const unit of pilotUnits) {
    assert.ok(
      new RegExp(escapeRegExp(unit.title)).test(html),
      `la unidad del piloto «${unit.title}» debe estar presente en el HTML renderizado`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// 11c · V3 con una cantidad de unidades distinta a la del piloto — mismo componente, HTML
//      renderizado real, total genuinamente diferente (2 vs. el total del piloto).
// ---------------------------------------------------------------------------------------------
test('TenderIntegralAnalysisV3View renderiza el HTML real con una cantidad de unidades distinta a la del piloto', () => {
  assert.notEqual(ANALYSIS.integral_analysis.analysis_units.length, AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT, 'el fixture compartido de este archivo debe diferir genuinamente del piloto en cantidad');
  const html = renderReactComponent(TenderIntegralAnalysisV3View, { analysis: ANALYSIS });
  assert.ok(html.includes(`<dd>${ANALYSIS.integral_analysis.analysis_units.length}</dd>`), 'el resumen renderizado debe mostrar el total real de este fixture, no el del piloto');
  assert.ok(!html.includes(`<dd>${AGT002_MANIZALES_V3_ANALYZABLE_REQUIREMENT_COUNT}</dd>`), 'el resumen renderizado no puede filtrar el total del piloto con un fixture distinto');
});

// ---------------------------------------------------------------------------------------------
// 11d · Fases vacías (sin unidades clasificadas) conviven con fases que traen evidencia
//      pendiente: el HTML real debe mostrar el mensaje honesto de fase vacía y abrir sólo la fase
//      con pendientes, con su conteo real de pendientes.
// ---------------------------------------------------------------------------------------------
const PHASES_ANALYSIS = {
  run_id: 'run-phases',
  snapshot_id: 'snap-phases',
  evidence_coverage: READY_EVIDENCE_COVERAGE,
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  current: true,
  critical_open_count: 0,
  integral_analysis: {
    contract_version: 'test@1',
    coverage: {
      manifest_version: 'test@1',
      expected_requirement_ids: ['req-fase-habilitante', 'req-fase-tecnica'],
      analyzed_requirement_ids: ['req-fase-habilitante', 'req-fase-tecnica'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'test@1',
      company_evidence_class_ids: [],
      legal_corpus_version_id: null,
    },
    analysis_units: [
      integralUnit({ unit_id: 'fase-u1', requirement_id: 'req-fase-habilitante', title: 'Unidad sin pendientes', sequence: 1, category: 'habilitating' }),
      integralUnit({
        unit_id: 'fase-u2',
        requirement_id: 'req-fase-tecnica',
        title: 'Unidad con evidencia pendiente',
        sequence: 2,
        category: 'technical',
        missing_evidence: [{ missing_id: 'fase-u2-missing', evidence_class_id: null, needed_source_type: 'company_evidence', reason: 'Falta el soporte técnico de esta unidad.', critical: true }],
      }),
    ],
  },
  decision_review: null,
};

test('TenderIntegralAnalysisV3View renderiza fases vacías con el mensaje honesto y abre sólo la fase con pendientes', () => {
  const html = renderReactComponent(TenderIntegralAnalysisV3View, { analysis: PHASES_ANALYSIS });

  // Descarte, Financiero/ejecución y Estratégico no reciben ninguna unidad en este fixture.
  assert.equal(
    countOf(html, 'Sin requisitos clasificados en esta fase.'),
    3,
    'las tres fases sin unidades clasificadas deben mostrar el mensaje honesto de fase vacía',
  );

  const tagAround = index => html.slice(Math.max(0, index - 40), index + 40);
  const habilitatingIndex = html.indexOf('data-phase="habilitating"');
  assert.ok(!tagAround(habilitatingIndex).includes('open=""'), 'la fase sin evidencia pendiente no se abre automáticamente');

  const technicalIndex = html.indexOf('data-phase="technical"');
  assert.ok(tagAround(technicalIndex).includes('open=""'), 'la fase con evidencia pendiente se abre automáticamente');
  assert.ok(html.includes('1 pendiente(s) de evidencia'), 'la fase con pendientes debe mostrar su conteo real de pendientes');
  assert.ok(html.includes('Falta el soporte técnico de esta unidad.'), 'la razón real de la evidencia pendiente debe aparecer en el HTML');
});

test('#tender-document-review y #tender-analysis son hermanos y el id no se duplica', () => {
  assert.ok(!analysisSource.includes('id="tender-analysis"'), 'TenderAnalysisSection no debe declarar el id de sección');
  assert.equal(countOf(mainSource, 'id="tender-document-review"'), 1);
  assert.equal(countOf(mainSource, 'id="tender-analysis"'), 1);
  const documentsIndex = mainSource.indexOf('id="tender-document-review"');
  const analysisIndex = mainSource.indexOf('id="tender-analysis"');
  assert.ok(documentsIndex >= 0 && analysisIndex > documentsIndex, 'Documentos debe preceder a Análisis');
  const between = mainSource.slice(documentsIndex, analysisIndex);
  assert.ok(between.includes('</div>'), 'Documentos debe cerrarse antes de abrir Análisis (hermanos, no anidados)');
  const html = render();
  assert.ok(!html.includes('id="tender-analysis"'), 'el HTML renderizado del componente no puede traer un segundo ancla');
});

// ---------------------------------------------------------------------------------------------
// 12 · Task 5 · Decisión se reduce a síntesis y el registro humano conserva su estado formal.
// ---------------------------------------------------------------------------------------------
function renderBrief(overrides = {}) {
  return renderToStaticMarkup(createElement(TenderDecisionBrief, {
    analysis: ANALYSIS,
    commercialContext: { amountLabel: '$1.000', city: 'Manizales', commercialFitPositives: ['Encaje explícito con vigilancia'] },
    ...overrides,
  }));
}

test('el brief renderizado es compacto y no filtra evidencia, V3, capacidad ni trámites', () => {
  const html = renderBrief();
  for (const expected of [
    'Potencial comercial',
    'Impedimentos',
    'Condiciones pendientes',
    'Encaje explícito con vigilancia',
    'Domicilio exigido en el municipio',
    'Certificación de experiencia específica',
    'Pendiente de validación',
    'Revisar 2 condiciones pendientes',
    'Registrar decisión humana',
  ]) assert.ok(html.includes(expected), `el brief debe conservar ${expected}`);

  for (const hidden of [
    'RATIONALE-INTERNO-EXPERIENCIA-NUNCA-VISIBLE',
    'RATIONALE-INTERNO-TERRITORIALIDAD-NUNCA-VISIBLE',
    'ETIQUETA-INTERNA-EXPERIENCIA',
    CONDITION_PRESENTED_ID,
    IMPEDIMENT_ID,
    'Capacidad financiera acreditada',
    'Póliza de seriedad de la oferta',
    'Evidencia de capacidad revisada',
    'Trámites preparables',
    'Trazabilidad completa',
    'Ver evidencia',
    'Ver análisis técnico completo',
    'action_required',
    'Vigente',
    'Vencida',
  ]) assert.ok(!html.includes(hidden), `el brief compacto no puede renderizar ${hidden}`);

  const intro = html.match(/<p class="tender-decision-brief-headline">([\s\S]*?)<\/p>/)?.[1] || '';
  assert.ok(intro, 'el brief debe conservar una introducción gobernada');
  assert.ok((intro.match(/[.!?](?:\s|$)/g) || []).length <= 3, 'la introducción debe tener como máximo tres frases');
});

test('los CTA del brief sólo navegan al análisis o al registro humano y no preparan GO o NO GO', () => {
  const html = renderBrief();
  assert.ok(html.includes('Revisar 2 condiciones pendientes'), 'debe existir el CTA de pendientes');
  assert.ok(!html.includes('Registrar GO'), 'el brief nunca debe ofrecer GO');
  assert.ok(!html.includes('Registrar NO GO'), 'el brief nunca debe ofrecer NO GO');
  assert.match(briefSource, /openAnchor\('tender-go-no-go-actions'\)/, 'Registrar decisión humana debe navegar al control formal');
  assert.doesNotMatch(briefSource, /tender-decision-register-(go|nogo)|open\(['"](?:go|no_go)/, 'la navegación del brief no puede seleccionar ni persistir una decisión');
});

test('al hacer click los CTA sólo desplazan y enfocan Análisis o el registro, sin seleccionar ni persistir GO/NO GO', () => {
  const tree = TenderDecisionBrief({
    analysis: ANALYSIS,
    commercialContext: { commercialFitPositives: ['Encaje explícito con vigilancia'] },
  });
  const buttons = [];
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  const text = node => Array.isArray(node) ? node.map(text).join('') : String(node ?? '');
  const button = label => buttons.find(item => text(item.props.children) === label);
  const analysisButton = button('Revisar 2 condiciones pendientes');
  const registerButton = button('Registrar decisión humana');
  assert.ok(analysisButton && registerButton, 'el árbol React debe exponer ambos CTA compactos');

  const originalDocument = globalThis.document;
  const originalDetails = globalThis.HTMLDetailsElement;
  const originalFetch = globalThis.fetch;
  const events = [];
  let persistenceCalls = 0;
  const target = id => ({
    scrollIntoView: () => events.push(`scroll:${id}`),
    focus: () => events.push(`focus:${id}`),
  });
  const targets = new Map([
    ['tender-analysis', target('tender-analysis')],
    ['tender-go-no-go-actions', target('tender-go-no-go-actions')],
  ]);
  globalThis.document = { getElementById: id => targets.get(id) || null };
  globalThis.HTMLDetailsElement = class HTMLDetailsElement {};
  globalThis.fetch = () => { persistenceCalls += 1; return Promise.resolve(); };
  try {
    analysisButton.props.onClick();
    registerButton.props.onClick();
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLDetailsElement = originalDetails;
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(events, [
    'scroll:tender-analysis',
    'focus:tender-analysis',
    'scroll:tender-go-no-go-actions',
    'focus:tender-go-no-go-actions',
  ]);
  assert.equal(persistenceCalls, 0, 'los CTA no pueden persistir una decisión');
  assert.ok(!events.some(event => /register-(go|nogo)|:(go|no_go)$/.test(event)), 'los CTA no enfocan ni preseleccionan GO/NO GO');
});

test('el resumen puro muestra la decisión humana vigente, autor, fecha y justificación', () => {
  const current = {
    id: 'decision-1', opportunity_id: 'op-1', tender_id: 'tender-1', decision: 'go', analysis_interaction_id: null,
    analysis_run_id: RUN_ID, justification: 'La responsable aprobó continuar.', decided_by: 'profile-1',
    decided_at: '2026-08-12T09:00:00.000Z', psi_sales_profiles: { full_name: 'Encargada de Licitaciones' },
  };
  const html = renderToStaticMarkup(createElement(TenderGoNoGoDecisionSummary, { loading: false, current }));
  for (const expected of ['Decisión humana vigente', 'GO registrado', 'La responsable aprobó continuar.', 'Encargada de Licitaciones', '2026']) {
    assert.ok(html.includes(expected), `el resumen debe mostrar ${expected}`);
  }
  const loading = renderToStaticMarkup(createElement(TenderGoNoGoDecisionSummary, { loading: true, current: null }));
  assert.ok(loading.includes('Cargando…'), 'el estado de carga pertenece al resumen puro');
  assert.ok(!loading.includes('Sin decisión humana registrada'), 'la carga no debe declararse como estado vacío');
  assert.ok(panelSource.includes('<TenderGoNoGoDecisionSummary loading={loading} current={current} />'), 'el panel debe delegar la decisión vigente al resumen puro');
});

// ---------------------------------------------------------------------------------------------
// 12b · TenderGoNoGoDecisionSummary sin decisión humana registrada aún: fallback exacto, sin
//       Cargando ni datos de una decisión inexistente.
// ---------------------------------------------------------------------------------------------
test('el resumen puro muestra el fallback exacto cuando no hay decisión humana registrada todavía', () => {
  const html = renderReactComponent(TenderGoNoGoDecisionSummary, { loading: false, current: null });
  assert.ok(html.includes('Sin decisión humana registrada'), 'sin decisión vigente el resumen debe mostrar el fallback exacto');
  assert.ok(!html.includes('Cargando…'), 'el fallback de estado vacío no puede confundirse con el estado de carga');
  assert.ok(!html.includes('GO registrado'), 'sin decisión no puede insinuar GO');
  assert.ok(!html.includes('NO GO registrado'), 'sin decisión no puede insinuar NO GO');
});

// ---------------------------------------------------------------------------------------------
// 12c · TenderGoNoGoDecisionSummary con NO GO registrado (espejo del caso GO ya cubierto).
// ---------------------------------------------------------------------------------------------
test('el resumen puro muestra NO GO registrado, autor, fecha y justificación', () => {
  const current = {
    id: 'decision-2', opportunity_id: 'op-1', tender_id: 'tender-1', decision: 'no_go', analysis_interaction_id: null,
    analysis_run_id: RUN_ID, justification: 'El impedimento territorial no se subsanó a tiempo.', decided_by: 'profile-1',
    decided_at: '2026-08-15T11:30:00.000Z', psi_sales_profiles: { full_name: 'Encargada de Licitaciones' },
  };
  const html = renderReactComponent(TenderGoNoGoDecisionSummary, { loading: false, current });
  for (const expected of ['Decisión humana vigente', 'NO GO registrado', 'El impedimento territorial no se subsanó a tiempo.', 'Encargada de Licitaciones', '2026']) {
    assert.ok(html.includes(expected), `el resumen debe mostrar ${expected}`);
  }
  assert.ok(!html.includes('GO registrado y'), 'NO GO nunca puede leerse como si fuera GO');
  assert.ok(!/\bGO registrado\b/.test(html.replace('NO GO registrado', '')), 'el HTML no puede contener GO registrado por separado del rótulo NO GO registrado');
});

// ---------------------------------------------------------------------------------------------
// 13 · Important fix · el CTA de pendientes cuenta solo las condiciones no resueltas.
//     DECISION_REVIEW tiene 2 condiciones; al pasar una respuesta resolved para una de ellas
//     el CTA debe decir exactamente 'Revisar 1 condiciones pendientes', no 2.
// ---------------------------------------------------------------------------------------------
test('el CTA de pendientes sólo cuenta las condiciones cuyo estado sigue siendo Pendiente de validación', () => {
  const htmlSinRespuestas = renderBrief();
  assert.ok(htmlSinRespuestas.includes('Revisar 2 condiciones pendientes'), 'sin respuestas las 2 condiciones son pendientes');

  const htmlConUnaResuelta = renderBrief({
    questionResponses: [responseFor(CONDITION_PRESENTED_ID, 'resolved')],
  });
  assert.ok(
    !htmlConUnaResuelta.includes('Revisar 2 condiciones pendientes'),
    'con una condición resuelta el CTA no debe contar 2 pendientes',
  );
  assert.ok(
    htmlConUnaResuelta.includes('Revisar 1 condiciones pendientes'),
    'con una condición resuelta el CTA debe decir exactamente Revisar 1 condiciones pendientes',
  );
});

// ---------------------------------------------------------------------------------------------
// 13b · Important fix · TenderGoNoGoDecisionPanel también debe contar sólo condiciones no
//      resueltas para "Revisar pendientes en Análisis (N)": debe consumir questionResponses vía
//      tenderDecisionConditions, igual que ya hace el brief (sección 13).
// ---------------------------------------------------------------------------------------------
const TenderGoNoGoDecisionPanel = await loadReactComponent(
  'src/tenders/components/TenderGoNoGoDecisionPanel.tsx',
  'TenderGoNoGoDecisionPanel',
);

const PANEL_ANALYSIS = {
  ...ANALYSIS,
  decision_review: {
    ...DECISION_REVIEW,
    blockers: [],
    decision_questions: [CONDITION_PRESENTED],
    counts: { ...DECISION_REVIEW.counts, blockers: 0, decision_questions: 1 },
  },
};

function renderPanel(overrides = {}) {
  return renderReactComponent(TenderGoNoGoDecisionPanel, {
    opportunityId: 'op-panel-1',
    opportunityName: 'Oportunidad de prueba',
    analysis: PANEL_ANALYSIS,
    currentProfile: null,
    request: async () => ({}),
    onChanged: () => {},
    questionResponses: [],
    ...overrides,
  });
}

test('el panel formal cuenta pendientes con la respuesta humana más reciente, no con el total gobernado', () => {
  const pendingHtml = renderPanel({ questionResponses: [responseFor(CONDITION_PRESENTED_ID, 'pending')] });
  assert.ok(
    pendingHtml.includes('Revisar pendientes en Análisis (1)'),
    'con la única condición aún pendiente el panel debe contar exactamente 1 pendiente',
  );

  const resolvedHtml = renderPanel({
    questionResponses: [
      // Desordenadas a propósito: gana la más reciente por responded_at, no el orden del arreglo.
      responseFor(CONDITION_PRESENTED_ID, 'resolved', { id: 'resp-nueva', responded_at: '2026-08-12T09:00:00.000Z' }),
      responseFor(CONDITION_PRESENTED_ID, 'pending', { id: 'resp-vieja', responded_at: '2026-08-10T15:00:00.000Z' }),
    ],
  });
  assert.ok(
    !resolvedHtml.includes('Revisar pendientes en Análisis'),
    'con la respuesta más reciente resuelta el panel no puede seguir anunciando pendientes',
  );

  assert.match(
    panelSource,
    /tenderDecisionConditions\(analysis\?\.decision_review,\s*questionResponses\)/,
    'el panel debe pasar questionResponses al selector, igual que el brief',
  );
  assert.match(
    panelSource,
    /if \(pendingConditions\.length > 0\) warnings\.push\('Hay condiciones pendientes de validar con la encargada\. Revise el brief de decisión\.'\);/,
    'la advertencia de pendientes debe seguir condicionada exclusivamente por pendingConditions.length, sin lógica paralela que la reintroduzca al vaciarse la colección',
  );
});

// ---------------------------------------------------------------------------------------------
// 14 · Task 6 · la vigencia temporal de la oportunidad vive una sola vez, en el banner del shell.
//      Análisis y Decisión no la repiten ni la convierten en una alerta crítica. Se afirma sobre
//      el HTML realmente renderizado, no sobre el texto fuente.
// ---------------------------------------------------------------------------------------------
test('Análisis y Decisión nunca repiten la vigencia ni levantan una alerta crítica de vencimiento', () => {
  const surfaces = [
    ['Análisis', render()],
    ['Decisión (brief)', renderBrief()],
    // El brief recibe la fecha de cierre como contexto comercial: mostrarla es legítimo, degradarla
    // a una segunda alerta de vencimiento no lo es.
    ['Decisión (brief con fecha de cierre)', renderBrief({
      commercialContext: { amountLabel: '$1.000', closeLabel: '21/08/2026', city: 'Manizales', commercialFitPositives: ['Encaje explícito con vigilancia'] },
    })],
    ['Decisión (resumen humano sin decisión)', renderToStaticMarkup(createElement(TenderGoNoGoDecisionSummary, { loading: false, current: null }))],
  ];
  for (const [name, html] of surfaces) {
    // `Vigente` / `Vencida` en mayúscula inicial son exclusivamente las palabras del banner.
    // «Análisis vigente» o «documentos vigentes» (minúscula, otro eje) siguen permitidos.
    assert.equal(countOf(html, 'Vigente'), 0, `${name} no puede escribir la vigencia de la oportunidad`);
    assert.equal(countOf(html, 'Vencida'), 0, `${name} no puede escribir el vencimiento de la oportunidad`);
    assert.ok(!/alerta crítica/i.test(html), `${name} no puede levantar una alerta crítica de vigencia`);
    assert.ok(!/d[ií]as restantes/i.test(html), `${name} no puede repetir el conteo regresivo del cierre`);
    assert.ok(!/Plazo:/.test(html), `${name} no puede mostrar un indicador de plazo capaz de degradar a Vencida`);
  }
});

test('main mantiene sincronizadas las respuestas humanas entre Análisis y el brief de Decisión', () => {
  assert.match(mainSource, /useState<TenderQuestionResponse\[\]>\(\[\]\)/, 'el estado padre debe estar tipado sin import inline');
  assert.match(mainSource, /onQuestionResponsesChanged\?: \(responses: TenderQuestionResponse\[\]\) => void/, 'el panel documental debe exponer el callback tipado');
  assert.match(mainSource, /onQuestionResponsesChanged\?\.\(data\.question_responses \|\| \[\]\)/, 'la carga documental debe publicar las respuestas persistidas');
  assert.match(mainSource, /onQuestionResponsesChanged\?\.\(data\.question_responses\)/, 'guardar una respuesta debe actualizar el estado padre');
  assert.match(mainSource, /onQuestionResponsesChanged=\{responses =>/, 'OpportunityDetail debe conectar el callback del panel');
  assert.match(mainSource, /questionResponses=\{tenderQuestionResponses\}/, 'el brief debe recibir las respuestas humanas vigentes');
  assert.match(panelSource, /id="tender-go-no-go-actions"[^>]*tabIndex=\{-1\}/, 'el destino del CTA debe aceptar foco programático real');
});

// ---------------------------------------------------------------------------------------------
// Task 7 QA · `#tender-analysis` ya es el landmark exterior del expediente. El contenido de
// TenderAnalysisSection debe ser sólo una superficie interior, no un segundo landmark <section>
// anidado que axe reporta como landmark-unique.
// ---------------------------------------------------------------------------------------------
test('TenderAnalysisSection usa un contenedor interior no landmark bajo el landmark tender-analysis', () => {
  const html = render();
  assert.match(
    html,
    /^<div class="tender-analysis-section\b/,
    'la superficie interior debe iniciar como <div>; el landmark lo aporta exclusivamente #tender-analysis',
  );
  assert.doesNotMatch(
    html,
    /<section\b[^>]*class="[^"]*tender-analysis-section/,
    'TenderAnalysisSection no puede introducir un landmark section redundante dentro de #tender-analysis',
  );
});
