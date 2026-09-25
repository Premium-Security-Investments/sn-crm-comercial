import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

// A) Estático ----------------------------------------------------------------

const componentSource = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const combinedSource = `${componentSource}\n${stylesSource}`;

test('agt003-contact-channel-intent-ui (static): pregunta el canal del próximo contacto', () => {
  assert.match(componentSource, /¿Cómo será el próximo contacto\?/);
});

test('agt003-contact-channel-intent-ui (static): pregunta el objetivo del contacto', () => {
  assert.match(componentSource, /¿Qué necesita lograr con este contacto\?/);
});

test('agt003-contact-channel-intent-ui (static): incluye el CTA "Generar seguimiento"', () => {
  assert.match(componentSource, /Generar seguimiento/);
});

test('agt003-contact-channel-intent-ui (static): incluye el control "Cambiar preparación"', () => {
  assert.match(componentSource, /Cambiar preparación/);
});

test('agt003-contact-channel-intent-ui (static): incluye el botón "Copiar WhatsApp"', () => {
  assert.match(componentSource, /Copiar WhatsApp/);
});

test('agt003-contact-channel-intent-ui (static): el body del generate serializa contact_channel', () => {
  const generateCallMatch = componentSource.match(/JSON\.stringify\(\{[^}]*\}\)/s);
  assert.ok(generateCallMatch, 'debe existir un JSON.stringify en la llamada de generate');
  assert.match(generateCallMatch[0], /contact_channel/);
});

test('agt003-contact-channel-intent-ui (static): no incluye el copy de piloto interno', () => {
  assert.doesNotMatch(combinedSource, /Piloto interno: revise antes de usar/);
});

test('agt003-contact-channel-intent-ui (static): ningún radio de canal viene marcado por defecto', () => {
  assert.doesNotMatch(combinedSource, /type=["']radio["'][^>]*defaultChecked/);
  assert.doesNotMatch(combinedSource, /defaultChecked[^>]*type=["']radio["']/);
  assert.doesNotMatch(combinedSource, /type=["']radio["'][^>]*checked=\{true\}/);
  assert.doesNotMatch(combinedSource, /checked=\{true\}[^>]*type=["']radio["']/);
});

test('agt003-contact-channel-intent-ui (static): el campo de intención limita a 500 caracteres', () => {
  assert.match(componentSource, /maxLength=\{500\}/);
});

// B) DOM -----------------------------------------------------------------------

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

function findButtonByText(container, text) {
  return [...container.querySelectorAll('button')].find(button => button.textContent === text);
}

test('agt003-contact-channel-intent-ui (dom): al montar, "Generar seguimiento" está deshabilitado y sin radios marcados', async () => {
  const request = () => new Promise(() => {});
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-1', request, preflight, contextVersion: 'v1' });

  const generateButton = view.container.querySelector('.vigia-copilot-generate button') || findButtonByText(view.container, 'Generar seguimiento');
  assert.ok(generateButton, 'debe existir el botón "Generar seguimiento"');
  assert.equal(generateButton.disabled, true, 'el botón debe iniciar deshabilitado sin canal seleccionado');

  const radios = [...view.container.querySelectorAll('input[type="radio"]')];
  assert.ok(radios.length > 0, 'debe existir al menos un radio de canal');
  assert.equal(radios.filter(radio => radio.checked).length, 0, 'ningún radio debe iniciar marcado');

  await view.unmount();
});

test('agt003-contact-channel-intent-ui (dom): seleccionar WhatsApp habilita el botón y el generate manda contact_channel sin commercial_intent', async () => {
  const calls = [];
  let resolveGenerate;
  const request = (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { resolveGenerate = () => resolve(okResult(null)); });
  };
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-1', request, preflight, contextVersion: 'v1' });

  const whatsappRadio = view.container.querySelector('input[type="radio"][value="whatsapp"]');
  assert.ok(whatsappRadio, 'debe existir un radio de canal con value="whatsapp"');
  await view.click('input[type="radio"][value="whatsapp"]');

  const generateButton = view.container.querySelector('.vigia-copilot-generate button') || findButtonByText(view.container, 'Generar seguimiento');
  assert.equal(generateButton.disabled, false, 'tras elegir WhatsApp el botón debe habilitarse');

  await view.click('.vigia-copilot-generate button');

  assert.equal(calls.length, 1, 'generate debe llamarse exactamente una vez');
  assert.equal(calls[0].url, '/api/vigia/copilot/generate');
  assert.equal(calls[0].body.contact_channel, 'whatsapp');
  assert.equal(Object.hasOwn(calls[0].body, 'commercial_intent'), false, 'sin intención escrita no debe enviarse commercial_intent');

  resolveGenerate();
  await view.flush();

  assert.equal(view.container.querySelector('input[type="text"]#vigia-copilot-subject, .vigia-copilot-draft input[type="text"]'), null, 'con asunto null no debe existir un input de asunto visible');
  const copyWhatsappButton = findButtonByText(view.container, 'Copiar WhatsApp');
  assert.ok(copyWhatsappButton, 'debe existir el botón "Copiar WhatsApp"');
  const copyEmailButton = findButtonByText(view.container, 'Copiar correo');
  assert.equal(copyEmailButton, undefined, 'no debe existir "Copiar correo" cuando el canal es WhatsApp');

  await view.unmount();
});

test('agt003-contact-channel-intent-ui (dom): canal email con intención manda contact_channel y commercial_intent, y ready muestra Copiar correo con asunto', async () => {
  const calls = [];
  let resolveGenerate;
  const request = (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { resolveGenerate = () => resolve(okResult('Asunto de seguimiento')); });
  };
  const view = mountWithJsdom(VigiaOpportunityCopilot, { opportunityId: 'op-2', request, preflight, contextVersion: 'v1' });

  await view.click('input[type="radio"][value="email"]');

  const intentField = view.container.querySelector('textarea[maxlength="500"], input[maxlength="500"]');
  assert.ok(intentField, 'debe existir un campo de intención con maxLength 500');
  const isTextarea = intentField.tagName === 'TEXTAREA';
  const nativeSetter = Object.getOwnPropertyDescriptor(
    isTextarea ? view.window.HTMLTextAreaElement.prototype : view.window.HTMLInputElement.prototype,
    'value',
  ).set;
  nativeSetter.call(intentField, 'cerrar agenda');
  intentField.dispatchEvent(new view.window.Event('input', { bubbles: true }));
  await view.flush();

  await view.click('.vigia-copilot-generate button');

  assert.equal(calls.length, 1, 'generate debe llamarse exactamente una vez');
  assert.equal(calls[0].body.contact_channel, 'email');
  assert.equal(calls[0].body.commercial_intent, 'cerrar agenda');

  resolveGenerate();
  await view.flush();

  const copyEmailButton = findButtonByText(view.container, 'Copiar correo');
  assert.ok(copyEmailButton, 'en ready con canal email debe existir "Copiar correo"');
  const subjectField = view.container.querySelector('.vigia-copilot-draft input');
  assert.ok(subjectField, 'con asunto presente debe existir el campo de asunto');
  assert.equal(subjectField.value, 'Asunto de seguimiento');

  await view.unmount();
});

console.log('AGT-003 contact channel/intent UI checks passed');
