import assert from 'node:assert/strict';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const VigiaCopilotProposal = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaCopilotProposal');

const brief = {
  summary: 'Oportunidad por COP 125.000.000 en etapa Propuesta.',
  facts: [{ text: 'El valor registrado es COP 125.000.000.', evidence_refs: ['e1'] }],
  inferences: [{ text: 'El cliente sigue evaluando alternativas.', evidence_refs: ['e2'], confidence: 'medium' }],
  missing_information: ['Correo del contacto decisor', 'approved_assets vigentes para el sector'],
  contact_objective: 'Reactivar la conversación y confirmar el decisor.',
  strategy: 'Primero confirme el decisor.\nSegundo acuerde una reunión.\nTercero documente el resultado.',
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

const at = needle => {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `la propuesta debe renderizar "${needle}"`);
  return index;
};
const plan = at('vigia-copilot-plan');
const planTitle = at('Plan de contacto');
const editor = at('vigia-copilot-draft');
const actions = at('vigia-copilot-actions');
const review = at('vigia-human-warning');
const context = at('vigia-copilot-context');
assert.ok(plan <= planTitle && planTitle < editor, 'el plan numerado abre la propuesta antes del correo');
assert.ok(editor < actions, 'las acciones siguen al correo editable');
assert.ok(actions < review && review < context, 'la revisión humana queda junto a las acciones y antes del contexto');

const planBlock = /<section class="vigia-copilot-plan">([\s\S]*?)<\/section>/.exec(html);
assert.ok(planBlock, 'Plan de contacto usa una sección propia');
assert.match(planBlock[1], /<ol>/);
assert.equal((planBlock[1].match(/<li>/g) ?? []).length, 3, 'cada paso saneado es un ítem ordenado');
for (const step of ['Primero confirme el decisor.', 'Segundo acuerde una reunión.', 'Tercero documente el resultado.']) {
  assert.ok(planBlock[1].includes(step));
}

assert.equal(html.includes('Antes de contactar'), false);
assert.equal(html.includes('vigia-copilot-missing'), false);
assert.equal(html.includes('Acción recomendada'), false);
assert.equal(html.includes('vigia-copilot-warnings'), false);
assert.equal(html.includes('Alertas comerciales'), false, 'la propuesta no duplica las alertas canónicas del preflight');
assert.equal(html.includes('Correo del contacto decisor'), false, 'missing_information ya no se presenta');
assert.equal(html.includes('No hay contacto decisor verificado'), false, 'warnings ya no se presentan');

const detailsMatch = /<details class="vigia-copilot-context">([\s\S]*?)<\/details>/.exec(html);
assert.ok(detailsMatch, '`Contexto analizado` debe ser plegable');
assert.match(detailsMatch[1], /<summary[^>]*>[\s\S]*Contexto analizado/);
assert.ok(detailsMatch[1].includes(brief.summary));
assert.ok(detailsMatch[1].includes('Objetivo de contacto'));
assert.ok(detailsMatch[1].includes(brief.contact_objective));
assert.equal(/<details[^>]*\sopen(=|\s|>)/.test(html), false, 'el contexto arranca plegado');

for (const forbidden of ['input no confiable', 'instrucciones embebidas', 'approved_assets', 'evidence_refs']) {
  assert.equal(html.includes(forbidden), false, `la UI no puede exponer "${forbidden}"`);
}
assert.ok(html.includes('>Copiar correo</button>'));
assert.ok(html.includes('>Descartar</button>'));
assert.equal(html.includes('>Útil<'), false);
assert.equal(html.includes('Necesita cambios'), false);
assert.ok(html.includes('Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.'));

const withAssets = renderReactComponent(VigiaCopilotProposal, {
  brief: { ...brief, recommended_asset_ids: ['asset-approved-001'] },
  draft, onDraftChange: noop, onCopy: noop, onDiscard: noop,
});
assert.ok(withAssets.includes('Adjuntos sugeridos'));
assert.ok(withAssets.includes('asset-approved-001'));

console.log('AGT-003 copilot proposal render checks passed');
