import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const VigiaCopilotProposal = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaCopilotProposal');

const brief = {
  summary: 'La oportunidad sigue en etapa de propuesta, sin respuesta del cliente en dos semanas.',
  facts: [{ text: 'El cliente confirmó presupuesto aprobado internamente.', evidence_refs: ['e1'] }],
  inferences: [{ text: 'El cliente sigue evaluando alternativas.', evidence_refs: ['e2'], confidence: 'medium' }],
  missing_information: ['Correo del contacto decisor'],
  contact_objective: 'Reactivar la conversación y confirmar el decisor.',
  strategy: 'Primero confirme el decisor.\nSegundo acuerde una reunión.\nTercero documente el resultado.',
  draft: { subject: 'Seguimiento a la propuesta', body: 'Buen día, retomo el contacto…' },
  recommended_asset_ids: [],
  warnings: [],
  human_review_required: true,
};
const draft = { subject: 'Seguimiento a la propuesta', body: 'Buen día, retomo el contacto…' };
const noop = () => {};
const html = renderReactComponent(VigiaCopilotProposal, { brief, draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop });

const at = needle => {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `la propuesta debe renderizar "${needle}"`);
  return index;
};

// Sin foco programático: ningún elemento lleva tabIndex={-1}; hay una región role="status" oculta
// que anuncia el resultado a lectores de pantalla sin mover el foco del usuario.
assert.equal(/tabindex="-1"/.test(html), false, 'ningún elemento debe llevar tabIndex={-1} (foco programático retirado)');
assert.match(html, /<p role="status" class="sr-only">Propuesta preparada para revisión\.<\/p>/, 'debe existir una región role="status" oculta que anuncie la propuesta sin mover el foco');

const header = at('vigia-copilot-proposal-header');
const briefSection = at('vigia-copilot-brief');
const draftSection = at('vigia-copilot-draft');
const review = at('vigia-human-warning');
const actions = at('vigia-copilot-actions');
const context = at('vigia-copilot-context');
assert.ok(header < briefSection && briefSection < draftSection, 'orden: cabecera, luego Situación actual/Información por confirmar/Objetivo del próximo contacto, luego el borrador editable');
assert.ok(draftSection < review && review < actions, 'Revisión humana aparece antes de Copiar correo/Descartar');
assert.ok(actions < context, 'Contexto y evidencia va al final, plegado');

// Cabecera: "Actualizar propuesta" vive junto al título, no aislada entre alertas y resultado.
const headerMatch = /<header class="vigia-copilot-proposal-header">([\s\S]*?)<\/header>/.exec(html);
assert.ok(headerMatch, 'debe existir <header class="vigia-copilot-proposal-header">');
assert.match(headerMatch[1], /<h4>Propuesta de seguimiento<\/h4>/);
assert.match(headerMatch[1], /<button type="button" class="secondary">Actualizar propuesta<\/button>/);

// Situación actual / Información por confirmar / Objetivo del próximo contacto, en ese orden, con rótulo visible.
const briefMatch = /<section class="vigia-copilot-brief">([\s\S]*?)<\/section>/.exec(html);
assert.ok(briefMatch);
const rows = [...briefMatch[1].matchAll(/<div class="vigia-copilot-brief-row"><strong>([^<]+)<\/strong><p>([^<]*)<\/p><\/div>/g)];
assert.deepEqual(rows.map(r => r[1]), ['Situación actual', 'Información por confirmar', 'Objetivo del próximo contacto']);
assert.equal(rows[0][2], brief.summary);
assert.equal(rows[1][2], 'Correo del contacto decisor');
assert.equal(rows[2][2], brief.contact_objective);

// Siguiente paso destacado, sólo cuando la recomendación no se abstiene.
assert.match(html, /<div class="vigia-copilot-next-step"><strong>Siguiente paso:<\/strong> <span>Primero confirme el decisor\.<\/span><\/div>/);
assert.equal(html.includes('vigia-copilot-why'), false, 'whyBullets ya no se renderiza (duplicaría Situación actual)');

// Contexto y evidencia: cerrado por defecto, con conteo, sin duplicar resumen/objetivo/plan.
assert.equal(/<details[^>]*\sopen(=|\s|>)/.test(html), false, 'el contexto arranca plegado');
const detailsMatch = /<details class="vigia-copilot-context">([\s\S]*?)<\/details>/.exec(html);
assert.ok(detailsMatch, '"Contexto y evidencia" debe ser plegable');
assert.match(detailsMatch[1], /<summary>Contexto y evidencia · 1 datos · 1 inferencias · 1 pendientes<\/summary>/);
assert.equal(detailsMatch[1].includes(brief.summary), false, 'el resumen no se duplica dentro del plegable');
assert.equal(detailsMatch[1].includes(brief.contact_objective), false, 'el objetivo no se duplica dentro del plegable');
assert.equal(detailsMatch[1].includes('Plan de contacto'), false, '"Plan de contacto" se retira del plegable (el primer paso ya vive arriba)');
assert.match(detailsMatch[1], /<h5>Datos utilizados<\/h5>/);
assert.match(detailsMatch[1], /<h5>Inferencias de Vig-IA · por confirmar<\/h5>/);
assert.match(detailsMatch[1], /<h5>Información no verificada<\/h5>/);
assert.ok(detailsMatch[1].includes('El cliente confirmó presupuesto aprobado internamente.'));
assert.ok(detailsMatch[1].includes('Correo del contacto decisor'));

// Insignias de confianza en español, nunca el valor crudo en inglés.
assert.match(detailsMatch[1], /El cliente sigue evaluando alternativas\. <span class="vigia-copilot-confidence confidence-medium">Media<\/span>/);
assert.equal(html.includes('Confianza medium'), false, 'la confianza cruda en inglés no debe exponerse');

for (const forbidden of ['input no confiable', 'instrucciones embebidas', 'approved_assets', 'evidence_refs', 'Ver contexto analizado', 'Borrador editable', 'Siguiente paso sugerido']) {
  assert.equal(html.includes(forbidden), false, `la UI no puede exponer "${forbidden}"`);
}
assert.ok(html.includes('>Copiar correo</button>'));
assert.ok(html.includes('>Descartar</button>'));
assert.ok(html.includes('Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.'));

const withAssets = renderReactComponent(VigiaCopilotProposal, {
  brief: { ...brief, recommended_asset_ids: ['asset-approved-001'] },
  draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop,
});
assert.ok(withAssets.includes('Adjuntos sugeridos'));
assert.ok(withAssets.includes('asset-approved-001'));

// Criterio 8: el resumen compacto se abstiene si repite una alerta activa; "Siguiente paso" desaparece,
// el resto de la propuesta (borrador, revisión humana, contexto) sigue visible.
const redundantAlerts = [{ key: 'next_action:overdue', category: 'next_action', risk_text: 'La próxima gestión está vencida hace 4 días.' }];
const redundantHtml = renderReactComponent(VigiaCopilotProposal, { brief: { ...brief, strategy: redundantAlerts[0].risk_text }, draft, alerts: redundantAlerts, onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop });
assert.equal(redundantHtml.includes('vigia-copilot-next-step'), false, 'sin recomendación distinta, no hay "Siguiente paso"');
assert.ok(redundantHtml.includes('vigia-copilot-draft') && redundantHtml.includes('vigia-copilot-context'), 'el resto de la propuesta sigue visible aunque se abstenga el siguiente paso');

// AGT-003 hotfix (se conserva): un "Siguiente paso" largo se renderiza completo, sin elipsis.
const longStrategy = ('Confirme con el cliente la fecha exacta de ' + 'la reunión de seguimiento propuesta sigue pendiente de confirmación final '.repeat(4)).trim();
const longHtml = renderReactComponent(VigiaCopilotProposal, { brief: { ...brief, strategy: longStrategy }, draft, alerts: [], onDraftChange: noop, onCopy: noop, onDiscard: noop, onRegenerate: noop });
assert.ok(longStrategy.length > 240, 'el texto de prueba debe superar el antiguo límite de 240 caracteres');
const longNextStepMatch = /<div class="vigia-copilot-next-step">([\s\S]*?)<\/div>/.exec(longHtml);
assert.ok(longNextStepMatch, 'el bloque "Siguiente paso" debe existir para una recomendación genuina');
assert.ok(longNextStepMatch[1].includes(longStrategy), 'el paso sugerido largo se renderiza íntegro');
assert.equal(longNextStepMatch[1].includes('…'), false, 'el bloque no contiene ninguna elipsis de truncado');

// Target táctil responsive: los controles del resultado deben cumplir min-height:44px (WCAG 2.5.5).
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const ruleHasMinHeight44 = selector => {
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRegex.exec(css))) {
    const selectors = match[1].split(',').map(s => s.trim());
    if (selectors.includes(selector) && /min-height:\s*44px\b/.test(match[2])) return true;
  }
  return false;
};
assert.ok(
  ruleHasMinHeight44('.vigia-copilot-proposal-header .secondary'),
  'los controles del resultado deben cumplir target táctil mínimo de 44px: falta min-height:44px en .vigia-copilot-proposal-header .secondary',
);
assert.ok(
  ruleHasMinHeight44('.vigia-copilot-actions button'),
  'los controles del resultado deben cumplir target táctil mínimo de 44px: falta min-height:44px en .vigia-copilot-actions button',
);

// Jerarquía visual de los tres rótulos: tamaño, peso, separación, línea lateral y fondo por fila.
assert.match(css, /\.vigia-copilot-brief-row\{display:grid;gap:5px;padding:5px 10px 5px 12px;border-left:3px solid #cbd5e1;border-radius:0 6px 6px 0;background:#f8fafc\}/, 'falta el tratamiento de fila (gap/padding/border-left/border-radius/background)');
assert.match(css, /\.vigia-copilot-brief-row strong\{font-size:14px;font-weight:700;text-transform:none;letter-spacing:normal;color:#17345b\}/, 'falta el rótulo en 14px/700/sin mayúsculas');
assert.match(css, /\.vigia-copilot-brief-row p\{margin:0;color:#17345b\}/, 'el párrafo de contenido no debe cambiar');
assert.match(css, /\.vigia-copilot-brief-row:nth-child\(1\)\{border-left-color:#1b64f2;background:#f5f8ff\}/, 'falta el acento de la fila 1 (azul primario)');
assert.match(css, /\.vigia-copilot-brief-row:nth-child\(2\)\{border-left-color:#64748b;background:#f8fafc\}/, 'falta el acento de la fila 2 (gris/slate)');
assert.match(css, /\.vigia-copilot-brief-row:nth-child\(3\)\{border-left-color:#4f46e5;background:#f7f6ff\}/, 'falta el acento de la fila 3 (índigo)');
for (const alarmColor of ['#dc2626', '#f59e0b', '#fbbf24', '#16a34a']) {
  assert.equal(
    new RegExp(`\\.vigia-copilot-brief-row:nth-child\\([1-3]\\)\\{border-left-color:${alarmColor}`).test(css),
    false,
    `ninguna fila puede usar el color de alarma ${alarmColor}`,
  );
}

console.log('AGT-003 copilot proposal render checks passed');
