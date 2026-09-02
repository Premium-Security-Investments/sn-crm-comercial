import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const entry = new URL('../src/vigia/copilot-presentation.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  COMMERCIAL_TEXT_FALLBACKS,
  isTechnicalCopilotText,
  normalizeCopilotErrorMessage,
  presentCompactCopilotSummary,
  presentCopilotBrief,
  splitContactPlanSteps,
  humanizePresentedText,
  summarizeMissingInformation,
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
  'Luego acuerde la fecha; Después documente el resultado.',
]);
assert.deepEqual(splitContactPlanSteps('Confirme el siguiente paso con el cliente'), ['Confirme el siguiente paso con el cliente']);
assert.deepEqual(splitContactPlanSteps(''), [''], 'la función pura conserva un único fragmento incluso para texto vacío; presentCopilotBrief aporta el fallback no vacío');
const pathological = Array.from({ length: 9 }, (_, index) => `Paso ${index + 1}.`).join(' ');
assert.deepEqual(splitContactPlanSteps(pathological), [pathological], 'más de ocho fragmentos vuelven al bloque único');

// Regresión (review AGT-003): ':' y ';' no son fin de oración. Una acción como "Solicitar a
// Daniela: Confirmar quién lidera la revisión; Así podremos resolver el bloqueador." debe
// permanecer como un único paso completo; solo '.', '?' o '!' deben partir el plan.
const colonSemicolonStrategy = 'Solicitar a Daniela: Confirmar quién lidera la revisión; Así podremos resolver el bloqueador.';
assert.deepEqual(
  splitContactPlanSteps(colonSemicolonStrategy),
  [colonSemicolonStrategy],
  'los dos puntos y el punto y coma no deben partir una acción en curso en varios pasos',
);

const brief = Object.freeze({
  summary: 'La oportunidad está valorada en COP 125.000.000 dentro de la etapa Propuesta.',
  facts: Object.freeze([
    Object.freeze({ text: 'El valor registrado alcanza COP 125.000.000 según el CRM.', evidence_refs: Object.freeze(['e1']) }),
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

const COP_GROUPING = new Intl.NumberFormat('es-CO');
const expectedSummary = `La oportunidad está valorada en $${COP_GROUPING.format(125000000)} COP dentro de la etapa Propuesta.`;
const expectedFactText = `El valor registrado alcanza $${COP_GROUPING.format(125000000)} COP según el CRM.`;

const snapshot = JSON.stringify(brief);
const presented = presentCopilotBrief(brief);

assert.deepEqual(presented.contactPlanSteps, [
  'Primero confirme el decisor.',
  'Luego proponga una reunión de 20 minutos.',
]);
assert.equal(presented.contactObjective, brief.contact_objective);
assert.equal(presented.summary, expectedSummary, 'el resumen debe pasar por el sanitizador compartido antes de presentarse');
assert.deepEqual(presented.facts, [{ text: expectedFactText, evidence_refs: brief.facts[0].evidence_refs }], 'cada fact debe humanizarse con el mismo sanitizador que la evidencia de Prioridades Comerciales');
assert.deepEqual(presented.inferences, [brief.inferences[0]]);
assert.deepEqual(presented.recommendedAssetIds, []);
assert.equal(presented.hasApprovedAssets, false);
assert.deepEqual(presented.missingInformation, ['Correo del contacto decisor']);
assert.equal(presented.missingSummary, 'Correo del contacto decisor');
for (const removed of ['strategy', 'warnings']) {
  assert.equal(removed in presented, false, `${removed} ya no forma parte de la presentación`);
}
assert.equal('draft' in presented, false, 'el borrador editable no se reencuadra en presentación');
assert.equal(JSON.stringify(brief), snapshot, 'presentCopilotBrief no muta el brief persistido');

// Degradación conservadora por marcador explícito: un fact "Seguimiento migrado:" nunca aparece
// en Datos utilizados — se mueve, sin reescribir su texto, a Información no verificada.
const migratedBrief = {
  ...brief,
  facts: [...brief.facts, { text: 'Seguimiento migrado: Llamada. 4 24 horas', evidence_refs: [] }],
};
const migratedPresented = presentCopilotBrief(migratedBrief);
assert.deepEqual(
  migratedPresented.facts,
  [{ text: expectedFactText, evidence_refs: brief.facts[0].evidence_refs }],
  'el fact con el marcador de migración no debe aparecer en Datos utilizados',
);
assert.ok(
  migratedPresented.missingInformation.includes('Seguimiento migrado: Llamada. 4 24 horas'),
  'el fact migrado se degrada a Información no verificada, con su texto intacto (no calza ningún patrón de fecha/monto)',
);
assert.equal(migratedPresented.missingInformation.length, 2, 'la lista de no verificados suma el original más el fact migrado');
assert.equal(
  migratedPresented.missingSummary,
  `${migratedPresented.missingInformation[0]} (+1 más)`,
  'con más de un elemento, el resumen "Falta" muestra el primero y cuenta el resto',
);

assert.equal(summarizeMissingInformation([]), 'Sin brechas de información pendientes según el registro.', 'sin brechas, el resumen debe ser el mensaje explícito, nunca una cadena vacía');

const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const isoText = 'Próxima gestión vencida: 2026-07-21T14:29:00+00:00.';
assert.equal(
  humanizePresentedText(isoText),
  `Próxima gestión vencida: ${BOGOTA_DATETIME_LABEL.format(new Date('2026-07-21T14:29:00+00:00'))}.`,
  'humanizePresentedText debe ser un alias directo del sanitizador compartido',
);
assert.equal(humanizePresentedText('4 24 horas'), '4 24 horas', 'texto no reconocido por el sanitizador debe quedar intacto');

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

const distinctPresented = Object.freeze({
  summary: 'Resumen', contactObjective: 'Objetivo',
  contactPlanSteps: Object.freeze(['Proponga una reunión de 20 minutos con el decisor financiero.']),
  facts: Object.freeze([{ text: 'El valor registrado es COP 125.000.000.', evidence_refs: [] }]),
  inferences: Object.freeze([{ text: 'El cliente sigue evaluando alternativas.', evidence_refs: [], confidence: 'medium' }]),
  recommendedAssetIds: [], hasApprovedAssets: false,
});
const baseAlerts = Object.freeze([{ key: 'next_action:overdue', category: 'next_action', risk_text: 'La próxima gestión está vencida hace 4 días.' }]);
const snap = [JSON.stringify(distinctPresented), JSON.stringify(baseAlerts)];
const compact = presentCompactCopilotSummary(distinctPresented, baseAlerts);
assert.equal(compact.nextStep, distinctPresented.contactPlanSteps[0]);
assert.deepEqual(compact.whyBullets, ['El valor registrado es COP 125.000.000.', 'El cliente sigue evaluando alternativas.']);
assert.deepEqual([JSON.stringify(distinctPresented), JSON.stringify(baseAlerts)], snap, 'no muta sus argumentos');

// AGT-003 hotfix: "Siguiente paso sugerido"/"Por qué" deben renderizarse completos, sin ningún
// truncado ni elipsis en JS que oculte parte del texto (la UI, no el adaptador, decide envolver).
const longStep = 'Paso siguiente muy detallado con contexto extenso que documenta cada acuerdo alcanzado hasta ahora. '.repeat(4).trim();
const longFact = 'Hecho relevante muy extenso repetido con múltiples cláusulas y referencias específicas de la oportunidad. '.repeat(3).trim();
const untruncated = presentCompactCopilotSummary({ ...distinctPresented, contactPlanSteps: [longStep], facts: [{ text: longFact, evidence_refs: [] }], inferences: [] }, []);
assert.ok(longStep.length > 240, 'el texto de prueba debe superar el antiguo límite de 240 caracteres');
assert.ok(longFact.length > 180, 'el texto de prueba debe superar el antiguo límite de 180 caracteres');
assert.equal(untruncated.nextStep, longStep, 'nextStep se renderiza completo, sin truncar');
assert.deepEqual(untruncated.whyBullets, [longFact], 'whyBullets se renderiza completo, sin truncar');
assert.equal(untruncated.nextStep.includes('…'), false, 'nextStep nunca agrega una elipsis');
assert.ok(untruncated.whyBullets.every(bullet => !bullet.includes('…')), 'whyBullets nunca agrega una elipsis');

// La misma acción con ':' y ';' internos debe llegar completa a compact.nextStep, no solo al
// paso crudo de splitContactPlanSteps: el resumen compacto no debe reintroducir el truncado.
const compactColonSemicolon = presentCompactCopilotSummary(
  { ...distinctPresented, contactPlanSteps: [colonSemicolonStrategy] },
  [],
);
assert.equal(
  compactColonSemicolon.nextStep,
  colonSemicolonStrategy,
  'compact.nextStep conserva la acción completa sin truncar en los dos puntos/punto y coma',
);

for (const [label, override, alerts] of [
  ['repite una alerta activa', { contactPlanSteps: ['  LA PRÓXIMA GESTIÓN   está vencida HACE 4 días.  '] }, baseAlerts],
  ['iguala el resguardo de estrategia', { contactPlanSteps: [COMMERCIAL_TEXT_FALLBACKS.strategy] }, []],
]) assert.deepEqual(presentCompactCopilotSummary({ ...distinctPresented, ...override }, alerts), { nextStep: null, whyBullets: [] }, label);

const noEvidence = presentCompactCopilotSummary({ ...distinctPresented, facts: [], inferences: [] }, []);
assert.equal(noEvidence.nextStep, distinctPresented.contactPlanSteps[0]);
assert.deepEqual(noEvidence.whyBullets, []);

// Deduplicación de razones: nextStep es válido y distinto de las alertas, pero uno de los
// facts repite (tras normalizar espacios/mayúsculas) el risk_text de una alerta activa. Esa
// señal no debe aparecer en whyBullets; las razones no duplicadas sí quedan, hasta un máximo de 2,
// preservando el orden facts→inferences.
const dedupeAlerts = Object.freeze([
  { key: 'next_action:overdue', category: 'next_action', risk_text: 'La próxima gestión está vencida hace 4 días.' },
]);
const dedupePresented = Object.freeze({
  summary: 'Resumen', contactObjective: 'Objetivo',
  contactPlanSteps: Object.freeze(['Proponga una reunión de 20 minutos con el decisor financiero.']),
  facts: Object.freeze([
    Object.freeze({ text: '  LA PRÓXIMA GESTIÓN   está vencida HACE 4 días.  ', evidence_refs: [] }),
    Object.freeze({ text: 'El valor registrado es COP 125.000.000.', evidence_refs: [] }),
  ]),
  inferences: Object.freeze([
    Object.freeze({ text: 'El cliente sigue evaluando alternativas.', evidence_refs: [], confidence: 'medium' }),
  ]),
  recommendedAssetIds: [], hasApprovedAssets: false,
});
const dedupeSnap = [JSON.stringify(dedupePresented), JSON.stringify(dedupeAlerts)];
const dedupeResult = presentCompactCopilotSummary(dedupePresented, dedupeAlerts);
assert.equal(dedupeResult.nextStep, dedupePresented.contactPlanSteps[0], 'nextStep sigue siendo la recomendación genuina, no repetida');
assert.deepEqual(dedupeResult.whyBullets, [
  'El valor registrado es COP 125.000.000.',
  'El cliente sigue evaluando alternativas.',
], 'la razón que duplica (normalizada) el risk_text de una alerta activa se filtra; quedan las 2 razones no duplicadas en orden facts→inferences');
assert.deepEqual([JSON.stringify(dedupePresented), JSON.stringify(dedupeAlerts)], dedupeSnap, 'no muta sus argumentos');

assert.deepEqual(
  presentCompactCopilotSummary({ summary: '', contactObjective: '', contactPlanSteps: [], facts: [], inferences: [], recommendedAssetIds: [], hasApprovedAssets: false }, []),
  { nextStep: null, whyBullets: [] }, 'brief mínimo nunca lanza',
);

console.log('AGT-003 copilot presentation checks passed');
