import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

const start = main.indexOf('function FollowUpForm(');
assert.notEqual(start, -1, 'FollowUpForm must exist in src/main.tsx');
const end = main.indexOf('\nconst publicActuationOptions', start);
assert.notEqual(end, -1, 'FollowUpForm boundary marker missing (publicActuationOptions)');
const followUp = main.slice(start, end);

// 1) the internal interaction type values must stay exactly as-is, in order.
assert.match(
  main,
  /const interactionTypes = \['llamada','correo','reunion','whatsapp','nota','cambio_estado','documento'\];/,
  'internal interaction type values must remain llamada, correo, reunion, whatsapp, nota, cambio_estado, documento',
);

// 2) each internal value must be shown with its Spanish visible label (as an option label, not a placeholder).
const labelByValue = {
  llamada: 'Llamada',
  correo: 'Correo',
  reunion: 'Reunión',
  whatsapp: 'WhatsApp',
  nota: 'Nota',
  cambio_estado: 'Cambio de estado',
  documento: 'Documento',
};
for (const [value, label] of Object.entries(labelByValue)) {
  const labelAsOption = new RegExp(`[:,]\\s*'${label}'`);
  assert.match(followUp, labelAsOption, `FollowUpForm must render "${label}" as the visible label for the internal value '${value}'`);
}

// 3) the follow-up type selector must be wrapped directly by a visible "Tipo de seguimiento" label.
assert.match(
  followUp,
  /<label>Tipo de seguimiento<Select\s+value=\{form\.interaction_type\}[^<]*\/?>\s*<\/label>/,
  'FollowUpForm must wrap the interaction_type Select directly inside a "Tipo de seguimiento" label',
);

// 4) the author selector, when rendered under profiles.length > 1, must be wrapped directly by a visible "Registrado por" label.
assert.match(
  followUp,
  /\{profiles\.length > 1 && <label>Registrado por<Select\s+value=\{form\.created_by\}[^<]*\/?>\s*<\/label>\}/,
  'FollowUpForm must wrap the created_by Select directly inside a "Registrado por" label, rendered only when profiles.length > 1',
);

// 5) the optional next-action field copy must change from "Programar próxima gestión" to "Próxima gestión (opcional)".
assert.ok(!followUp.includes('Programar próxima gestión'), 'FollowUpForm must drop the old "Programar próxima gestión" copy');
const nextActionLabelIndex = followUp.indexOf('Próxima gestión (opcional)');
assert.notEqual(nextActionLabelIndex, -1, 'FollowUpForm must show "Próxima gestión (opcional)" for the optional next action field');
const nextActionInputIndex = followUp.indexOf('value={form.next_action_at}');
assert.ok(
  nextActionInputIndex !== -1 && nextActionLabelIndex < nextActionInputIndex && nextActionInputIndex - nextActionLabelIndex < 80,
  '"Próxima gestión (opcional)" must directly label the next_action_at input',
);

// 6) the required notes textarea must be wrapped directly by a visible "Detalle del seguimiento" label.
assert.match(
  followUp,
  /<label>Detalle del seguimiento<textarea required[^<]*\/?>\s*<\/label>/,
  'FollowUpForm must wrap the required notes textarea directly inside a "Detalle del seguimiento" label',
);

// 7) the notes textarea placeholder must read exactly as specified.
assert.ok(
  followUp.includes('placeholder="Registre el resultado, los acuerdos y el siguiente paso"'),
  'FollowUpForm textarea must use the exact placeholder "Registre el resultado, los acuerdos y el siguiente paso"',
);

// 8) preserve the save action, the endpoint, and the payload field names.
assert.ok(followUp.includes('Guardar seguimiento'), 'FollowUpForm must keep the "Guardar seguimiento" action label');
assert.ok(followUp.includes('/api/opportunity-interactions?id='), 'FollowUpForm must keep posting to /api/opportunity-interactions');
for (const field of ['interaction_type:', 'notes:', 'occurred_at:', 'created_by:', 'next_action_at:']) {
  assert.ok(followUp.includes(field), `FollowUpForm payload must keep the "${field.slice(0, -1)}" field name`);
}

console.log('follow-up form copy static checks passed');
