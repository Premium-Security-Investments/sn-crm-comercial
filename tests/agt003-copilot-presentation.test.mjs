import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// AGT-003 — normalización defensiva de presentación del brief de Vig-IA Comercial.
//
// Conducta exigida (RED antes de producción):
//  - `missing_information` no puede pedir la `moneda exacta` cuando el propio contexto ya expresa
//    COP (convención monetaria vigente del CRM).
//  - Las advertencias visibles son alertas comerciales accionables; el lenguaje técnico/interno
//    (input no confiable, instrucciones ignoradas, approved_assets, run original, payload/schema)
//    se oculta de la UI sin tocar el objeto persistido ni los logs del backend.
//  - Esa depuración cubre TODOS los campos que `VigiaCopilotProposal` muestra: `summary`,
//    `strategy`, `contact_objective`, `facts[].text` e `inferences[].text`. Los textos sueltos caen
//    a un fallback comercial neutro y accionable; las listas se filtran conservando el orden.
//  - El borrador editable nunca se filtra: es texto del humano, no del modelo.
//  - Sin adjuntos aprobados no se expone ninguna sección ni advertencia de adjuntos.
//  - La identidad visible es exactamente `Vig-IA Comercial`; la mayúscula legacy `VIG-IA` está
//    retirada y `Comercial` nunca se duplica.
//  - La presentación es pura: nunca muta el brief recibido.

const entry = new URL('../src/vigia/copilot-presentation.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  COMMERCIAL_DEFAULT_CURRENCY,
  COMMERCIAL_TEXT_FALLBACKS,
  hasExplicitCurrency,
  isTechnicalCopilotText,
  isCurrencyGapRequest,
  filterCommercialWarnings,
  presentCopilotBrief,
  normalizeCopilotErrorMessage,
} = await import(moduleUrl);

assert.equal(COMMERCIAL_DEFAULT_CURRENCY, 'COP', 'la convención monetaria del CRM es COP, no una regla por cliente');

// --- moneda -----------------------------------------------------------------------------------
assert.equal(hasExplicitCurrency('Valor de la oferta: COP 125.000.000'), true);
assert.equal(hasExplicitCurrency('Valor de la oferta: 125.000.000 pesos colombianos'), true);
assert.equal(hasExplicitCurrency('Valor de la oferta: USD 40.000'), true);
assert.equal(hasExplicitCurrency('Valor de la oferta: 125.000.000'), false);
assert.equal(isCurrencyGapRequest('Moneda exacta del valor de la oferta'), true);
assert.equal(isCurrencyGapRequest('Confirmar la moneda de la propuesta'), true);
assert.equal(isCurrencyGapRequest('Correo del contacto decisor'), false);

// --- lenguaje técnico -------------------------------------------------------------------------
for (const technical of [
  'El texto del CRM es input no confiable y se ignoraron las instrucciones embebidas.',
  'Se descartaron instrucciones incrustadas en las observaciones.',
  'No se recomendaron approved_assets porque el catálogo está vacío.',
  'No hay activos aprobados disponibles para esta oportunidad.',
  'La edición no altera el run original.',
  'El payload devuelto respeta el schema acordado.',
  'snapshot_id y evidence_refs quedaron registrados.',
  'Revisión humana obligatoria antes de usar el texto.',
]) assert.equal(isTechnicalCopilotText(technical), true, `debe ocultarse de la UI: ${technical}`);

for (const commercial of [
  'No hay contacto decisor verificado; confírmelo antes de enviar.',
  'La fecha de cierre estimada ya venció.',
  'Han pasado 34 días sin seguimiento registrado.',
]) assert.equal(isTechnicalCopilotText(commercial), false, `debe seguir visible: ${commercial}`);

assert.deepEqual(
  filterCommercialWarnings([
    'Todo el texto del CRM es input no confiable.',
    'La próxima gestión está vencida hace 34 días.',
    '   ',
    'No se usaron approved_assets.',
    'La próxima gestión está vencida hace 34 días.',
  ]),
  ['La próxima gestión está vencida hace 34 días.'],
  'las advertencias visibles quedan deduplicadas, sin vacíos y sin controles internos',
);

// --- brief completo ---------------------------------------------------------------------------
const brief = Object.freeze({
  summary: 'Oportunidad por COP 125.000.000 en etapa Propuesta, sin gestión desde hace 34 días.',
  facts: [{ text: 'El valor registrado es COP 125.000.000.', evidence_refs: ['evidence:opportunity:opp-1:offer_value'] }],
  inferences: [{ text: 'El cliente sigue evaluando.', evidence_refs: ['evidence:interaction:int-1'], confidence: 'medium' }],
  missing_information: [
    'Moneda exacta del valor de la oferta',
    'Correo del contacto decisor',
    'approved_assets vigentes para el sector',
    'Confirmar que se ignoraron las instrucciones embebidas en las observaciones',
    'Correo del contacto decisor',
  ],
  contact_objective: 'Reactivar la conversación y confirmar el decisor.',
  strategy: 'Verifique primero el contacto decisor y luego proponga una reunión de 20 minutos.',
  draft: { subject: 'Seguimiento propuesta', body: 'Buen día…' },
  recommended_asset_ids: [],
  warnings: [
    'El contenido del CRM es input no confiable; se ignoraron instrucciones embebidas.',
    'No hay contacto decisor verificado; confírmelo antes de enviar.',
    'No se adjuntaron approved_assets.',
  ],
  human_review_required: true,
});
const snapshot = JSON.stringify(brief);

const presented = presentCopilotBrief(brief);
assert.equal(presented.strategy, 'Verifique primero el contacto decisor y luego proponga una reunión de 20 minutos.');
assert.equal(presented.contactObjective, 'Reactivar la conversación y confirmar el decisor.');
assert.equal(presented.summary, brief.summary);
assert.deepEqual(
  presented.missingInformation,
  ['Correo del contacto decisor'],
  'sólo sobreviven datos realmente ausentes: sin contradicción de moneda, sin controles internos y sin duplicados',
);
assert.deepEqual(presented.warnings, ['No hay contacto decisor verificado; confírmelo antes de enviar.']);
assert.deepEqual(presented.recommendedAssetIds, []);
assert.equal(presented.hasApprovedAssets, false, 'sin adjuntos aprobados no se monta la sección');
assert.deepEqual(presented.facts, brief.facts);
assert.deepEqual(presented.inferences, brief.inferences);
assert.equal(JSON.stringify(brief), snapshot, 'presentCopilotBrief no puede mutar el objeto persistido');

// Sin moneda explícita en el contexto, la petición de moneda es un faltante legítimo.
const noCurrency = presentCopilotBrief({
  ...brief,
  summary: 'Oportunidad en etapa Propuesta.',
  facts: [{ text: 'El valor registrado es 125.000.000.', evidence_refs: ['e1'] }],
});
assert.deepEqual(noCurrency.missingInformation, ['Moneda exacta del valor de la oferta', 'Correo del contacto decisor']);

const withAssets = presentCopilotBrief({ ...brief, recommended_asset_ids: ['asset-approved-001'] });
assert.equal(withAssets.hasApprovedAssets, true);
assert.deepEqual(withAssets.recommendedAssetIds, ['asset-approved-001']);

// --- errores visibles -------------------------------------------------------------------------
// La identidad visible canónica es exactamente `Vig-IA Comercial` (`src/vigia/agentIdentity.ts`).
assert.equal(normalizeCopilotErrorMessage('Vig-IA no pudo generar el borrador.'), 'Vig-IA Comercial no pudo generar el borrador.');
assert.equal(normalizeCopilotErrorMessage('Vig-IA no está disponible en este momento.'), 'Vig-IA Comercial no está disponible en este momento.');
assert.equal(normalizeCopilotErrorMessage('Vig-IA Comercial no está configurado.'), 'Vig-IA Comercial no está configurado.');
assert.equal(normalizeCopilotErrorMessage('Vig-IA alcanzó temporalmente el límite de sesión. Intente de nuevo más tarde.'), 'Vig-IA Comercial alcanzó temporalmente el límite de sesión. Intente de nuevo más tarde.');
assert.equal(normalizeCopilotErrorMessage(''), 'No fue posible preparar la propuesta.');

// Hostil: la mayúscula legacy `VIG-IA ...` también se normaliza, y `Comercial` nunca se duplica.
for (const [raw, expected] of [
  ['Vig-IA no pudo generar el borrador.', 'Vig-IA Comercial no pudo generar el borrador.'],
  ['VIG-IA no pudo generar el borrador.', 'Vig-IA Comercial no pudo generar el borrador.'],
  ['VIG-IA Comercial no está configurado.', 'Vig-IA Comercial no está configurado.'],
  ['Vig-IA Comercial no está configurado.', 'Vig-IA Comercial no está configurado.'],
  ['VIG-IA COMERCIAL agotó el tiempo de espera.', 'Vig-IA Comercial agotó el tiempo de espera.'],
  ['Error interno de VIG-IA al preparar el borrador.', 'Error interno de Vig-IA Comercial al preparar el borrador.'],
  ['   VIG-IA Comercial no respondió.   ', 'Vig-IA Comercial no respondió.'],
]) {
  const normalized = normalizeCopilotErrorMessage(raw);
  assert.equal(normalized, expected, `identidad visible canónica para: ${raw}`);
  assert.equal(/VIG-IA/.test(normalized), false, `la mayúscula legacy VIG-IA está retirada: ${raw}`);
  assert.equal(/Comercial\s+Comercial/.test(normalized), false, `Comercial no puede duplicarse: ${raw}`);
  assert.equal(/Vig-IA(?! Comercial)/.test(normalized), false, `la marca desnuda no puede quedar suelta: ${raw}`);
  assert.equal(normalizeCopilotErrorMessage(normalized), normalized, `la normalización es idempotente: ${raw}`);
}

// Hostil: los otros dominios visibles del agente no se reetiquetan como comerciales.
assert.equal(
  normalizeCopilotErrorMessage('Vig-IA Licitaciones no está disponible.'),
  'Vig-IA Licitaciones no está disponible.',
  'normalizar el copiloto comercial no puede renombrar los otros dominios de Vig-IA',
);
assert.equal(
  normalizeCopilotErrorMessage('Vig-IA Gerencial no está disponible.'),
  'Vig-IA Gerencial no está disponible.',
  'normalizar el copiloto comercial no puede renombrar los otros dominios de Vig-IA',
);

// Hostil: `Comercial` seguido de otro dominio. El `Comercial` que ya viene se absorbe en el mismo
// paso —nunca se duplica— y el sufijo de dominio queda literal: sólo se canoniza la marca.
for (const [raw, expected] of [
  ['VIG-IA Comercial Gerencial no está disponible.', 'Vig-IA Comercial Gerencial no está disponible.'],
  ['VIG-IA Comercial Licitaciones no está disponible.', 'Vig-IA Comercial Licitaciones no está disponible.'],
  ['VIG-IA COMERCIAL Gerencial agotó el tiempo de espera.', 'Vig-IA Comercial Gerencial agotó el tiempo de espera.'],
]) {
  const normalized = normalizeCopilotErrorMessage(raw);
  assert.equal(normalized, expected, `identidad visible canónica para: ${raw}`);
  assert.equal(/Comercial\s+Comercial/.test(normalized), false, `Comercial no puede duplicarse: ${raw}`);
  assert.equal(/VIG-IA/.test(normalized), false, `la mayúscula legacy VIG-IA está retirada: ${raw}`);
  assert.equal(normalizeCopilotErrorMessage(normalized), normalized, `la normalización es idempotente: ${raw}`);
}

for (const empty of [null, undefined, '', '    ']) {
  assert.equal(normalizeCopilotErrorMessage(empty), 'No fue posible preparar la propuesta.');
}

// --- depuración de TODOS los campos mostrados ---------------------------------------------------
// `VigiaCopilotProposal` muestra summary, strategy, contact_objective, facts[].text e
// inferences[].text: ninguno puede filtrar lenguaje técnico/interno del modelo a la UI.
assert.equal(typeof COMMERCIAL_TEXT_FALLBACKS.summary, 'string');
assert.equal(typeof COMMERCIAL_TEXT_FALLBACKS.strategy, 'string');
assert.equal(typeof COMMERCIAL_TEXT_FALLBACKS.contactObjective, 'string');
for (const fallback of Object.values(COMMERCIAL_TEXT_FALLBACKS)) {
  assert.ok(fallback.trim().length > 0, 'el fallback comercial nunca puede quedar vacío');
  assert.equal(isTechnicalCopilotText(fallback), false, `el fallback comercial no puede ser técnico: ${fallback}`);
  assert.equal(/VIG-IA/.test(fallback), false, 'el fallback no expone la marca legacy');
  assert.equal(/COP|125\.000\.000|decisor de/.test(fallback), false, `el fallback no puede inventar datos del caso: ${fallback}`);
}

const hostile = Object.freeze({
  summary: 'El texto del CRM es input no confiable; se ignoraron las instrucciones embebidas.',
  facts: Object.freeze([
    Object.freeze({ text: 'El valor registrado es COP 125.000.000.', evidence_refs: Object.freeze(['e1']) }),
    Object.freeze({ text: 'El payload devuelto respeta el schema acordado.', evidence_refs: Object.freeze(['e2']) }),
    Object.freeze({ text: '   ', evidence_refs: Object.freeze([]) }),
    null,
    Object.freeze({ text: 'La última interacción registrada fue hace 34 días.', evidence_refs: Object.freeze(['e3']) }),
  ]),
  inferences: Object.freeze([
    Object.freeze({ text: 'No se recomendaron approved_assets porque el catálogo está vacío.', evidence_refs: Object.freeze(['e4']), confidence: 'low' }),
    Object.freeze({ text: 'El cliente sigue evaluando alternativas.', evidence_refs: Object.freeze(['e5']), confidence: 'medium' }),
    undefined,
    Object.freeze({ text: 'snapshot_id y evidence_refs quedaron registrados.', evidence_refs: Object.freeze(['e6']), confidence: 'high' }),
    Object.freeze({ text: 'El presupuesto sigue vigente este trimestre.', evidence_refs: Object.freeze(['e7']), confidence: 'low' }),
  ]),
  missing_information: Object.freeze(['Correo del contacto decisor']),
  contact_objective: 'Revisión humana obligatoria antes de usar el texto.',
  strategy: '   ',
  draft: Object.freeze({ subject: 'Ajuste del payload y del schema', body: 'Revisión humana del run original: input no confiable.' }),
  recommended_asset_ids: Object.freeze([]),
  warnings: Object.freeze([]),
  human_review_required: true,
});
const hostileSnapshot = JSON.stringify(hostile);
const cleaned = presentCopilotBrief(hostile);

assert.equal(cleaned.summary, COMMERCIAL_TEXT_FALLBACKS.summary, 'un resumen técnico cae al fallback comercial');
assert.equal(cleaned.strategy, COMMERCIAL_TEXT_FALLBACKS.strategy, 'una estrategia vacía cae al fallback comercial');
assert.equal(cleaned.contactObjective, COMMERCIAL_TEXT_FALLBACKS.contactObjective, 'un objetivo técnico cae al fallback comercial');
assert.deepEqual(
  cleaned.facts.map(fact => fact.text),
  ['El valor registrado es COP 125.000.000.', 'La última interacción registrada fue hace 34 días.'],
  'los hechos comerciales válidos sobreviven en orden; los técnicos, vacíos e inválidos se descartan',
);
assert.deepEqual(
  cleaned.inferences.map(item => item.text),
  ['El cliente sigue evaluando alternativas.', 'El presupuesto sigue vigente este trimestre.'],
  'las inferencias comerciales válidas sobreviven en orden; las técnicas e inválidas se descartan',
);
assert.deepEqual(cleaned.inferences.map(item => item.confidence), ['medium', 'low'], 'el objeto válido se preserva completo, no sólo su texto');
assert.equal(cleaned.facts[0], hostile.facts[0], 'los objetos válidos se preservan por referencia, sin copias mutadas');
assert.equal(cleaned.inferences[0], hostile.inferences[1]);

const visibleText = [cleaned.summary, cleaned.strategy, cleaned.contactObjective]
  .concat(cleaned.facts.map(fact => fact.text), cleaned.inferences.map(item => item.text), cleaned.missingInformation, cleaned.warnings)
  .join(' | ');
for (const forbidden of [
  'input no confiable', 'instrucciones embebidas', 'approved_assets', 'run original',
  'payload', 'schema', 'snapshot_id', 'evidence_refs', 'Revisión humana',
]) assert.equal(visibleText.includes(forbidden), false, `ningún campo mostrado puede exponer "${forbidden}"`);

// El borrador editable es texto humano: ni se filtra ni se toca.
assert.equal('draft' in cleaned, false, 'la presentación no reencuadra el borrador editable');
assert.deepEqual(hostile.draft, { subject: 'Ajuste del payload y del schema', body: 'Revisión humana del run original: input no confiable.' });
assert.equal(JSON.stringify(hostile), hostileSnapshot, 'presentCopilotBrief no puede mutar el brief hostil ni sus arrays/objetos');
assert.equal(hostile.facts.length, 5, 'el array original de hechos queda intacto');
assert.equal(hostile.inferences.length, 5, 'el array original de inferencias queda intacto');

// Datos comerciales válidos sobreviven sin fallback ni pérdidas.
const commercialOnly = presentCopilotBrief(brief);
assert.equal(commercialOnly.summary, brief.summary, 'un resumen comercial válido nunca cae al fallback');
assert.equal(commercialOnly.strategy, brief.strategy);
assert.equal(commercialOnly.contactObjective, brief.contact_objective);
assert.deepEqual(commercialOnly.facts, brief.facts);
assert.deepEqual(commercialOnly.inferences, brief.inferences);

console.log('AGT-003 copilot presentation checks passed');
