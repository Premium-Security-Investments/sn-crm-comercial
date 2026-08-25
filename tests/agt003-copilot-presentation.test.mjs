import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// AGT-003 — normalización defensiva de presentación del brief de VIG-IA Comercial.
//
// Conducta exigida (RED antes de producción):
//  - `missing_information` no puede pedir la `moneda exacta` cuando el propio contexto ya expresa
//    COP (convención monetaria vigente del CRM).
//  - Las advertencias visibles son alertas comerciales accionables; el lenguaje técnico/interno
//    (input no confiable, instrucciones ignoradas, approved_assets, run original, payload/schema)
//    se oculta de la UI sin tocar el objeto persistido ni los logs del backend.
//  - Sin adjuntos aprobados no se expone ninguna sección ni advertencia de adjuntos.
//  - La presentación es pura: nunca muta el brief recibido.

const entry = new URL('../src/vigia/copilot-presentation.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  COMMERCIAL_DEFAULT_CURRENCY,
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
assert.equal(normalizeCopilotErrorMessage('Vig-IA no pudo generar el borrador.'), 'VIG-IA Comercial no pudo generar el borrador.');
assert.equal(normalizeCopilotErrorMessage('Vig-IA no está disponible en este momento.'), 'VIG-IA Comercial no está disponible en este momento.');
assert.equal(normalizeCopilotErrorMessage('VIG-IA Comercial no está configurado.'), 'VIG-IA Comercial no está configurado.');
assert.equal(normalizeCopilotErrorMessage(''), 'No fue posible preparar la propuesta.');

console.log('AGT-003 copilot presentation checks passed');
