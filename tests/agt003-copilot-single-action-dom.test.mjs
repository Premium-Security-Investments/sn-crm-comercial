import assert from 'node:assert/strict';
import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const VigiaOpportunityCopilot = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaOpportunityCopilot');
const preflight = {
  nextAction: { code: 'overdue', label: 'overdue', detail: 'Vencida hace 4 días', tone: 'critical', className: 'is-critical' },
  expectedClose: { code: 'scheduled', label: 'scheduled', detail: 'En 30 días', tone: 'ok', className: 'is-ok' },
  decisionMaker: { code: 'complete', label: 'complete', detail: 'Contacto verificado', tone: 'ok', className: 'is-ok' },
};
const okResult = subject => ({
  run_id: 'r1', status: 'completed', human_review_required: true,
  output: { brief: { summary: 'Resumen', facts: [], inferences: [], missing_information: [], contact_objective: 'Objetivo',
    strategy: 'Confirme la fecha de la próxima reunión con el cliente.', draft: { subject, body: 'Cuerpo' },
    recommended_asset_ids: [], warnings: [], human_review_required: true } },
});

{ // Criterio 4: un click invoca generate una vez, sólo /generate; se deshabilita mientras carga.
  const calls = []; let resolveGenerate;
  const request = url => { calls.push(url); return new Promise(r => { resolveGenerate = () => r(okResult('Asunto')); }); };
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-1', request, preflight, contextVersion: 'v1' });
  await view.click('.vigia-copilot-generate button');
  assert.deepEqual(calls, ['/api/vigia/copilot/generate']);
  assert.ok(view.container.querySelector('.vigia-copilot-generate button[disabled]'));
  assert.match(view.container.querySelector('[role="status"]').textContent, /está preparando un borrador acotado/);
  resolveGenerate(); await view.flush(); await view.unmount();
}

{ // Criterio 5/6: alertas persisten en error; error compacto, no bloqueante, único control.
  const request = () => Promise.reject(new Error('bridge unavailable'));
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-2', request, preflight, contextVersion: 'v1' });
  const alertsBefore = view.container.querySelector('.vigia-preflight-alerts').textContent;
  await view.click('.vigia-copilot-generate button'); await view.flush();
  assert.equal(view.container.querySelector('.vigia-preflight-alerts').textContent, alertsBefore);
  assert.equal(view.container.querySelector('.vigia-copilot-generate'), null, 'sin botón primario en error');
  assert.equal(view.container.querySelector('input[type="checkbox"]'), null);
  assert.equal(view.container.querySelector('.error'), null, 'no usa la clase genérica .error');
  const errorBlock = view.container.querySelector('.vigia-copilot-error');
  assert.equal(errorBlock.getAttribute('role'), 'alert');
  assert.match(errorBlock.textContent, /No se pudo preparar el seguimiento\. Puede continuar registrándolo manualmente\./);
  assert.equal(errorBlock.querySelectorAll('button').length, 1);
  assert.equal(view.container.querySelector('.vigia-copilot-result'), null, 'sin propuesta sintética');
  await view.unmount();
}

console.log('AGT-003 single-action DOM behavior checks passed');
