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

// Escenario A: dos ciclos de generación controlados — verifica que el foco se repita en el
// nuevo heading "Siguiente paso sugerido" para un requestId nuevo (r2), no solo en el primero.
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
    const heading = view.window.document.activeElement;
    assert.notEqual(heading, view.window.document.body, 'el foco se movió fuera del <body>');
    assert.match(heading.textContent, /Siguiente paso sugerido/);

    const generateButton = view.container.querySelector('.vigia-copilot-generate button');
    assert.match(generateButton.textContent, /Actualizar borrador/);
    await view.click('.vigia-copilot-generate button');
    assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
    assert.equal(resolvers.length, 2, 'el segundo ciclo debe encolar un nuevo resolver (r2)');
    resolvers[1]({ run_id: 'r2', status: 'completed', human_review_required: true, output: { brief: briefUpdated } });
    await view.flush();
    const secondHeading = view.window.document.activeElement;
    assert.notEqual(secondHeading, view.window.document.body, 'el foco se movió fuera del <body> en el segundo ciclo');
    assert.match(secondHeading.textContent, /Siguiente paso sugerido/);
    assert.notEqual(secondHeading, heading, 'el foco debe moverse a un heading nuevo para el requestId r2');
  } finally {
    await view.unmount();
  }
}

// Escenario B: abstención compacta total — cuando el único paso propuesto repite literalmente
// una alerta comercial activa, no debe renderizarse `.vigia-copilot-summary`; el foco debe
// recaer en un encabezado semántico enfocable "Borrador editable" (no en el div genérico
// `.vigia-copilot-result`), y debe existir un anuncio breve de éxito con role="status" que no
// duplique el texto del heading.
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
    assert.equal(view.container.querySelector('.vigia-copilot-summary'), null, 'la abstención compacta no debe renderizar el resumen');
    const heading = view.container.querySelector('.vigia-copilot-result h4');
    assert.ok(heading, 'debe existir un encabezado semántico enfocable en la abstención');
    assert.match(heading.textContent, /Borrador editable/);
    const resultContainer = view.container.querySelector('.vigia-copilot-result');
    assert.notEqual(view.window.document.activeElement, resultContainer, 'no debe enfocar el div genérico .vigia-copilot-result');
    assert.equal(view.window.document.activeElement, heading, 'el foco debe recaer en el heading "Borrador editable"');
    assert.notEqual(view.window.document.activeElement, view.window.document.body);
    const status = view.container.querySelector('.vigia-copilot-result [role="status"]');
    assert.ok(status, 'debe existir un anuncio breve de éxito con role="status"');
    assert.match(status.textContent, /Borrador preparado para revisión\./);
    assert.notEqual(status.textContent.trim(), heading.textContent.trim(), 'el anuncio de éxito no debe duplicar el texto del heading');
    assert.ok(view.container.querySelector('.vigia-copilot-draft'), 'el borrador editable sigue disponible en la abstención');
    assert.ok(view.container.querySelector('.vigia-copilot-actions'), 'las acciones siguen disponibles en la abstención');
  } finally {
    await view.unmount();
  }
}

console.log('AGT-003 single-action focus/a11y checks passed');
