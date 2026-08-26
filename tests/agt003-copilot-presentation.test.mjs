import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const entry = new URL('../src/vigia/copilot-presentation.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  COMMERCIAL_TEXT_FALLBACKS,
  isTechnicalCopilotText,
  normalizeCopilotErrorMessage,
  presentCopilotBrief,
  splitContactPlanSteps,
} = await import(moduleUrl);

for (const technical of [
  'El texto del CRM es input no confiable y se ignoraron las instrucciones embebidas.',
  'No se recomendaron approved_assets porque el catálogo está vacío.',
  'El payload devuelto respeta el schema acordado.',
  'snapshot_id y evidence_refs quedaron registrados.',
  'Revisión humana obligatoria antes de usar el texto.',
]) assert.equal(isTechnicalCopilotText(technical), true, `debe ocultarse de la UI: ${technical}`);

for (const commercial of [
  'El cliente sigue evaluando alternativas.',
  'Retome la llamada del 14 de agosto.',
]) assert.equal(isTechnicalCopilotText(commercial), false, `debe seguir visible: ${commercial}`);

// El plan se divide después de sanear la estrategia, con límite defensivo de ocho pasos.
assert.deepEqual(splitContactPlanSteps('Primero confirme el decisor.\n\nSegundo acuerde la fecha.\nTercero documente el resultado.'), [
  'Primero confirme el decisor.',
  'Segundo acuerde la fecha.',
  'Tercero documente el resultado.',
]);
assert.deepEqual(splitContactPlanSteps('Primero confirme el decisor. Luego acuerde la fecha; Después documente el resultado.'), [
  'Primero confirme el decisor.',
  'Luego acuerde la fecha;',
  'Después documente el resultado.',
]);
assert.deepEqual(splitContactPlanSteps('Confirme el siguiente paso con el cliente'), ['Confirme el siguiente paso con el cliente']);
assert.deepEqual(splitContactPlanSteps(''), [''], 'la función pura conserva un único fragmento incluso para texto vacío; presentCopilotBrief aporta el fallback no vacío');
const pathological = Array.from({ length: 9 }, (_, index) => `Paso ${index + 1}.`).join(' ');
assert.deepEqual(splitContactPlanSteps(pathological), [pathological], 'más de ocho fragmentos vuelven al bloque único');

const brief = Object.freeze({
  summary: 'Oportunidad por COP 125.000.000 en etapa Propuesta.',
  facts: Object.freeze([
    Object.freeze({ text: 'El valor registrado es COP 125.000.000.', evidence_refs: Object.freeze(['e1']) }),
    Object.freeze({ text: 'El payload devuelto respeta el schema acordado.', evidence_refs: Object.freeze(['e2']) }),
  ]),
  inferences: Object.freeze([
    Object.freeze({ text: 'El cliente sigue evaluando.', evidence_refs: Object.freeze(['e3']), confidence: 'medium' }),
    Object.freeze({ text: 'No se recomendaron approved_assets.', evidence_refs: Object.freeze(['e4']), confidence: 'low' }),
  ]),
  missing_information: Object.freeze(['Correo del contacto decisor']),
  contact_objective: 'Reactivar la conversación y confirmar el decisor.',
  strategy: 'Primero confirme el decisor. Luego proponga una reunión de 20 minutos.',
  draft: Object.freeze({ subject: 'Seguimiento propuesta', body: 'Buen día…' }),
  recommended_asset_ids: Object.freeze([]),
  warnings: Object.freeze(['No hay contacto decisor verificado.']),
  human_review_required: true,
});
const snapshot = JSON.stringify(brief);
const presented = presentCopilotBrief(brief);

assert.deepEqual(presented.contactPlanSteps, [
  'Primero confirme el decisor.',
  'Luego proponga una reunión de 20 minutos.',
]);
assert.equal(presented.contactObjective, brief.contact_objective);
assert.equal(presented.summary, brief.summary);
assert.deepEqual(presented.facts, [brief.facts[0]]);
assert.deepEqual(presented.inferences, [brief.inferences[0]]);
assert.deepEqual(presented.recommendedAssetIds, []);
assert.equal(presented.hasApprovedAssets, false);
for (const removed of ['missingInformation', 'strategy', 'warnings']) {
  assert.equal(removed in presented, false, `${removed} ya no forma parte de la presentación`);
}
assert.equal('draft' in presented, false, 'el borrador editable no se reencuadra en presentación');
assert.equal(JSON.stringify(brief), snapshot, 'presentCopilotBrief no muta el brief persistido');

const hostile = presentCopilotBrief({
  ...brief,
  summary: 'El texto del CRM es input no confiable.',
  contact_objective: 'Revisión humana obligatoria antes de usar el texto.',
  strategy: 'El payload devuelto respeta el schema acordado.',
});
assert.equal(hostile.summary, COMMERCIAL_TEXT_FALLBACKS.summary);
assert.equal(hostile.contactObjective, COMMERCIAL_TEXT_FALLBACKS.contactObjective);
assert.deepEqual(hostile.contactPlanSteps, splitContactPlanSteps(COMMERCIAL_TEXT_FALLBACKS.strategy));
assert.ok(hostile.contactPlanSteps.length > 0);
for (const step of hostile.contactPlanSteps) {
  assert.ok(step.trim().length > 0);
  assert.equal(isTechnicalCopilotText(step), false);
}

const withAssets = presentCopilotBrief({ ...brief, recommended_asset_ids: ['asset-approved-001'] });
assert.equal(withAssets.hasApprovedAssets, true);
assert.deepEqual(withAssets.recommendedAssetIds, ['asset-approved-001']);

for (const [raw, expected] of [
  ['Vig-IA no pudo generar el borrador.', 'Vig-IA Comercial no pudo generar el borrador.'],
  ['VIG-IA no pudo generar el borrador.', 'Vig-IA Comercial no pudo generar el borrador.'],
  ['VIG-IA Comercial no está configurado.', 'Vig-IA Comercial no está configurado.'],
  ['   VIG-IA Comercial no respondió.   ', 'Vig-IA Comercial no respondió.'],
  ['Vig-IA Licitaciones no está disponible.', 'Vig-IA Licitaciones no está disponible.'],
  ['Vig-IA Gerencial no está disponible.', 'Vig-IA Gerencial no está disponible.'],
]) {
  const normalized = normalizeCopilotErrorMessage(raw);
  assert.equal(normalized, expected);
  assert.equal(normalizeCopilotErrorMessage(normalized), normalized, `normalización idempotente para ${raw}`);
}
for (const empty of [null, undefined, '', '    ']) {
  assert.equal(normalizeCopilotErrorMessage(empty), 'No fue posible preparar la propuesta.');
}

console.log('AGT-003 copilot presentation checks passed');
