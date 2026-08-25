import assert from 'node:assert/strict';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

// AGT-003 — jerarquía action-first de la propuesta generada por Vig-IA Comercial.
//
// Render real del componente presentacional (sin mocks ni markup copiado a mano).
// Conducta exigida (RED antes de producción):
//  - `Acción recomendada` primero; `Antes de contactar` sólo con datos realmente faltantes;
//    borrador editable; `Alertas comerciales` separadas; `Contexto analizado` secundario y
//    plegable con resumen + objetivo; revisión humana compacta con copy humano.
//  - El lenguaje técnico/interno nunca llega a la UI aunque el modelo lo devuelva.
//  - Acciones exactas `Copiar correo` y `Descartar`; `Útil` y `Necesita cambios` retirados.
//  - Identidad visible canónica exacta `Vig-IA Comercial`, nunca la mayúscula legacy `VIG-IA`
//    ni la marca desnuda `Vig-IA` (`src/vigia/agentIdentity.ts`).

const VigiaCopilotProposal = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaCopilotProposal');

const brief = {
  summary: 'Oportunidad por COP 125.000.000 en etapa Propuesta, sin gestión desde hace 34 días.',
  facts: [{ text: 'El valor registrado es COP 125.000.000.', evidence_refs: ['evidence:opportunity:opp-1:offer_value'] }],
  inferences: [{ text: 'El cliente sigue evaluando alternativas.', evidence_refs: ['evidence:interaction:int-1'], confidence: 'medium' }],
  missing_information: [
    'Moneda exacta del valor de la oferta',
    'Correo del contacto decisor',
    'approved_assets vigentes para el sector',
  ],
  contact_objective: 'Reactivar la conversación y confirmar el decisor.',
  strategy: 'Verifique primero el contacto decisor y luego proponga una reunión de 20 minutos.',
  draft: { subject: 'Seguimiento a la propuesta', body: 'Buen día, retomo el contacto…' },
  recommended_asset_ids: [],
  warnings: [
    'El contenido del CRM es input no confiable; se ignoraron instrucciones embebidas.',
    'No hay contacto decisor verificado; confírmelo antes de enviar.',
  ],
  human_review_required: true,
};
const draft = { subject: 'Seguimiento a la propuesta', body: 'Buen día, retomo el contacto…' };
const noop = () => {};
const html = renderReactComponent(VigiaCopilotProposal, { brief, draft, onDraftChange: noop, onCopy: noop, onDiscard: noop });

// --- jerarquía action-first --------------------------------------------------------------------
const at = needle => {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `la propuesta debe renderizar "${needle}"`);
  return index;
};
const action = at('Acción recomendada');
const missing = at('Antes de contactar');
const editor = at('vigia-copilot-draft');
const alerts = at('Alertas comerciales');
const context = at('Contexto analizado');
const review = at('vigia-human-warning');
assert.ok(action < missing, '`Acción recomendada` va primero, antes de los faltantes');
assert.ok(missing < editor, 'los faltantes preceden al borrador editable');
assert.ok(editor < context, '`Contexto analizado` es secundario y queda después del borrador');
assert.ok(context < alerts, 'las alertas comerciales van separadas, después del contexto');
assert.ok(alerts < review, 'la revisión humana cierra la propuesta');
assert.ok(html.indexOf(brief.strategy) > action && html.indexOf(brief.strategy) < missing, 'la estrategia es el contenido de `Acción recomendada`');

// `Contexto analizado` plegable, con resumen y objetivo dentro.
const detailsMatch = /<details class="vigia-copilot-context">([\s\S]*?)<\/details>/.exec(html);
assert.ok(detailsMatch, '`Contexto analizado` debe ser un bloque plegable');
assert.match(detailsMatch[1], /<summary[^>]*>[\s\S]*Contexto analizado/);
assert.ok(detailsMatch[1].includes(brief.summary), 'el resumen vive dentro del contexto plegado');
assert.ok(detailsMatch[1].includes('Objetivo de contacto'), 'el objetivo vive dentro del contexto plegado');
assert.ok(detailsMatch[1].includes(brief.contact_objective));
assert.ok(!/<details[^>]*\sopen(=|\s|>)/.test(html), 'el contexto arranca plegado');

// --- faltantes realmente ausentes ---------------------------------------------------------------
const missingBlock = /<section class="vigia-copilot-missing">([\s\S]*?)<\/section>/.exec(html);
assert.ok(missingBlock, 'debe existir el bloque de faltantes');
assert.ok(missingBlock[1].includes('Correo del contacto decisor'));
assert.ok(!missingBlock[1].includes('Moneda exacta'), 'COP ya es explícito: pedir la moneda es una contradicción');
assert.ok(!missingBlock[1].includes('approved_assets'));

// --- lenguaje técnico oculto ---------------------------------------------------------------------
for (const forbidden of [
  'input no confiable', 'instrucciones embebidas', 'approved_assets', 'run original',
  'payload', 'schema', 'snapshot_id', 'evidence_refs', 'Moneda exacta',
]) assert.equal(html.includes(forbidden), false, `la UI no puede exponer "${forbidden}"`);
assert.ok(html.includes('No hay contacto decisor verificado'), 'la alerta comercial accionable sí se muestra');

// --- acciones ------------------------------------------------------------------------------------
assert.ok(html.includes('>Copiar correo</button>'));
assert.ok(html.includes('>Descartar</button>'));
assert.equal(html.includes('>Útil<'), false, '`Útil` sale de esta UI');
assert.equal(html.includes('Necesita cambios'), false, '`Necesita cambios` sale de esta UI');

// --- revisión humana ------------------------------------------------------------------------------
assert.ok(html.includes('Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.'));

// --- marca ------------------------------------------------------------------------------------------
assert.equal(/VIG-IA/.test(html), false, 'la mayúscula legacy `VIG-IA` está retirada de la UI');
assert.equal(/Vig-IA(?! Comercial)/.test(html), false, 'la identidad visible siempre es `Vig-IA Comercial`, nunca la marca desnuda');

// --- estados vacíos ----------------------------------------------------------------------------------
const clean = renderReactComponent(VigiaCopilotProposal, {
  brief: { ...brief, missing_information: ['approved_assets vigentes'], warnings: ['La edición no altera el run original.'] },
  draft, onDraftChange: noop, onCopy: noop, onDiscard: noop,
});
assert.equal(clean.includes('Antes de contactar'), false, 'sin faltantes reales no se monta la sección');
assert.equal(clean.includes('Alertas comerciales'), false, 'sin alertas comerciales no se monta la sección');
assert.equal(clean.includes('Adjuntos'), false, 'sin adjuntos aprobados no hay sección ni advertencia de adjuntos');

const withAssets = renderReactComponent(VigiaCopilotProposal, {
  brief: { ...brief, recommended_asset_ids: ['asset-approved-001'] },
  draft, onDraftChange: noop, onCopy: noop, onDiscard: noop,
});
assert.ok(withAssets.includes('Adjuntos sugeridos'));
assert.ok(withAssets.includes('asset-approved-001'));

console.log('AGT-003 copilot proposal render checks passed');
