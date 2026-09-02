import assert from 'node:assert/strict';
import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const VigiaOpportunityCopilot = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaOpportunityCopilot');
const preflight = {
  nextAction: { code: 'scheduled', label: 'scheduled', detail: 'En 10 días', tone: 'ok', className: 'is-ok' },
  expectedClose: { code: 'scheduled', label: 'scheduled', detail: 'En 30 días', tone: 'ok', className: 'is-ok' },
  decisionMaker: { code: 'complete', label: 'complete', detail: 'Contacto verificado', tone: 'ok', className: 'is-ok' },
};
const brief = {
  summary: 'Resumen', facts: [{ text: 'Hecho relevante.', evidence_refs: [] }], inferences: [], missing_information: [],
  contact_objective: 'Objetivo', strategy: 'Proponga una reunión de seguimiento con el cliente.',
  draft: { subject: 'Asunto', body: 'Cuerpo' }, recommended_asset_ids: [], warnings: [], human_review_required: true,
};
const briefUpdated = {
  summary: 'Resumen actualizado', facts: [{ text: 'Nuevo hecho relevante.', evidence_refs: [] }], inferences: [], missing_information: [],
  contact_objective: 'Objetivo actualizado', strategy: 'Envíe la propuesta comercial actualizada en las próximas 48 horas.',
  draft: { subject: 'Asunto actualizado', body: 'Cuerpo actualizado' }, recommended_asset_ids: [], warnings: [], human_review_required: true,
};

// Escenario A: dos ciclos de generación controlados. Contrato aprobado: no hay traslado
// programático de foco; tras cada generación el foco permanece en <body> y el estado se anuncia
// con un `role="status"` sr-only. El segundo ciclo se dispara desde el botón secundario del
// header de la propuesta (`.vigia-copilot-proposal-header button`), ya que el CTA externo
// `.vigia-copilot-generate` desaparece una vez existe un borrador (ready).
{
  const resolvers = [];
  const request = () => new Promise((resolve) => { resolvers.push(resolve); });
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-1', request, preflight, contextVersion: 'v1' });
  try {
    assert.equal(view.container.querySelector('[role="status"]'), null);
    await view.click('.vigia-copilot-generate button');
    assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
    assert.equal(resolvers.length, 1, 'el primer ciclo debe encolar exactamente un resolver');
    resolvers[0]({ run_id: 'r1', status: 'completed', human_review_required: true, output: { brief } });
    await view.flush();
    assert.equal(view.window.document.activeElement, view.window.document.body,
      'el contrato aprobado no traslada el foco programáticamente tras generar');
    const status = view.container.querySelector('.vigia-copilot-result [role="status"]');
    assert.ok(status, 'debe existir un anuncio sr-only con role="status" en la propuesta');
    assert.equal(status.textContent.trim(), 'Propuesta preparada para revisión.');

    const regenerateButton = view.container.querySelector('.vigia-copilot-proposal-header button');
    assert.ok(regenerateButton, 'el segundo ciclo se dispara desde el botón del header de la propuesta');
    assert.equal(regenerateButton.textContent, 'Actualizar propuesta');
    await view.click('.vigia-copilot-proposal-header button');
    assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
    assert.equal(resolvers.length, 2, 'el segundo ciclo debe encolar un nuevo resolver (r2)');
    resolvers[1]({ run_id: 'r2', status: 'completed', human_review_required: true, output: { brief: briefUpdated } });
    await view.flush();
    assert.equal(view.window.document.activeElement, view.window.document.body,
      'el contrato aprobado no traslada el foco programáticamente en el segundo ciclo');
    const secondStatus = view.container.querySelector('.vigia-copilot-result [role="status"]');
    assert.ok(secondStatus, 'debe existir el anuncio sr-only también en el segundo ciclo');
    assert.equal(secondStatus.textContent.trim(), 'Propuesta preparada para revisión.');
  } finally {
    await view.unmount();
  }
}

// Escenario B: cuando el único paso propuesto repite literalmente una alerta comercial activa,
// el contrato aprobado sigue renderizando la propuesta unificada: heading visible "Propuesta de
// seguimiento" (sin exigencia de que sea programáticamente enfocable), foco en <body>, el mismo
// anuncio sr-only exacto, y el borrador/acciones disponibles.
{
  const abstainPreflight = {
    nextAction: { code: 'overdue', label: 'Vencida', detail: 'Vencida hace 4 días', tone: 'critical', className: 'is-critical' },
    expectedClose: { code: 'scheduled', label: 'scheduled', detail: 'En 30 días', tone: 'ok', className: 'is-ok' },
    decisionMaker: { code: 'complete', label: 'complete', detail: 'Contacto verificado', tone: 'ok', className: 'is-ok' },
  };
  const abstainBrief = {
    summary: 'Resumen', facts: [{ text: 'Hecho relevante.', evidence_refs: [] }], inferences: [], missing_information: [],
    contact_objective: 'Objetivo', strategy: 'La próxima gestión está vencida hace 4 días.',
    draft: { subject: 'Asunto', body: 'Cuerpo' }, recommended_asset_ids: [], warnings: [], human_review_required: true,
  };
  let resolveAbstain;
  const abstainRequest = () => new Promise((resolve) => { resolveAbstain = resolve; });
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-2', request: abstainRequest, preflight: abstainPreflight, contextVersion: 'v1' });
  try {
    await view.click('.vigia-copilot-generate button');
    assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
    resolveAbstain({ run_id: 'r-abstain', status: 'completed', human_review_required: true, output: { brief: abstainBrief } });
    await view.flush();
    const heading = view.container.querySelector('.vigia-copilot-result h4');
    assert.ok(heading, 'debe existir el heading visible de la propuesta');
    assert.equal(heading.textContent, 'Propuesta de seguimiento');
    assert.equal(view.window.document.activeElement, view.window.document.body,
      'el contrato aprobado no traslada el foco programáticamente en la abstención');
    const status = view.container.querySelector('.vigia-copilot-result [role="status"]');
    assert.ok(status, 'debe existir el anuncio sr-only de éxito con role="status"');
    assert.equal(status.textContent.trim(), 'Propuesta preparada para revisión.');
    assert.ok(view.container.querySelector('.vigia-copilot-draft'), 'el borrador editable sigue disponible en la abstención');
    assert.ok(view.container.querySelector('.vigia-copilot-actions'), 'las acciones siguen disponibles en la abstención');
  } finally {
    await view.unmount();
  }
}

console.log('AGT-003 single-action focus/a11y checks passed');
