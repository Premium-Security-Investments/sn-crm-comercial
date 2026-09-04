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

// 4) the authenticated author is visible but fixed: no profile selector and no editable identity.
assert.match(
  followUp,
  /<label>Registrado por<input\s+value=\{currentProfile\.full_name\}[^>]*readOnly[^>]*\/>\s*<\/label>/,
  'FollowUpForm must render currentProfile.full_name as a read-only "Registrado por" identity',
);
assert.doesNotMatch(followUp, /profiles\.map|form\.created_by|<Select[^>]*created_by/, 'FollowUpForm must not expose an author selector');

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

// 7) the notes textarea placeholder is now a multiline module-level constant, interpolated as a JSX expression.
assert.match(main, /const FOLLOW_UP_NOTES_PLACEHOLDER = 'Resultado de la gestión\\nAcuerdos o compromisos\\nSiguiente paso';/);
assert.ok(followUp.includes('placeholder={FOLLOW_UP_NOTES_PLACEHOLDER}'), 'el placeholder multilínea debe venir de una expresión JSX');
assert.ok(!followUp.includes('placeholder="Registre el resultado'), 'el placeholder de una línea queda retirado');
assert.match(followUp, /<p className="followup-form-hint">Este registro alimenta el historial comercial y las recomendaciones de \{VIGIA_VISIBLE_NAMES\.commercial\}\./);

// 8) preserve the save action, endpoint and business fields, while omitting client-controlled authorship.
assert.ok(followUp.includes('Guardar seguimiento'), 'FollowUpForm must keep the "Guardar seguimiento" action label');
assert.ok(followUp.includes('/api/opportunity-interactions?id='), 'FollowUpForm must keep posting to /api/opportunity-interactions');
for (const field of ['interaction_type:', 'notes:', 'occurred_at:', 'next_action_at:']) {
  assert.ok(followUp.includes(field), `FollowUpForm payload must keep the "${field.slice(0, -1)}" field name`);
}
assert.doesNotMatch(followUp, /created_by\s*:/, 'FollowUpForm payload must never include created_by');

// 9) guardar sin próxima acción advierte, sin bloquear el envío ni completar la fecha automáticamente.
assert.match(
  followUp,
  /setStatus\(form\.next_action_at \? 'Seguimiento registrado\.' : 'Seguimiento registrado\. Falta agendar la próxima gestión\.'\)/,
  'guardar sin próxima acción debe mostrar una advertencia breve, sin bloquear el guardado',
);
assert.doesNotMatch(followUp, /next_action_at:\s*form\.next_action_at \|\| new Date/, 'nunca se debe inventar ni completar automáticamente la próxima acción');

console.log('follow-up form copy static checks passed');
