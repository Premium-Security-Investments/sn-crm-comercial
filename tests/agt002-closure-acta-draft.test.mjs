// Vig-IA profundiza el acta de cierre a partir de la nota de la persona.
// Nada de lo que devuelva el modelo entra crudo: se limpia, se acota y la cita
// textual la pone el servidor, no el modelo.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGT002_CLOSURE_ACTA_CAPABILITY,
  AGT002_CLOSURE_ACTA_MAX_ENTRIES,
  AGT002_CLOSURE_ACTA_OUTPUT_SCHEMA,
  AGT002_CLOSURE_ACTA_POLICY,
  buildClosureActaInput,
  closureActaClarifications,
  createClosureActaDrafter,
  normalizeClosureActaDraft,
} from '../verticales/licitaciones/agt002-closure-acta-draft.js';

const NOTA = 'Es un proceso 100% de tecnología y aún no cumplimos los requisitos para este tipo de proyectos.';
const OPPORTUNITY = '44444444-4444-4444-8444-444444444444';

const baseInput = (overrides = {}) => buildClosureActaInput({
  opportunityId: OPPORTUNITY,
  tenderName: 'Cali — Secretaría de Seguridad y Justicia',
  closureKind: 'cerrada_no_go',
  closingNote: NOTA,
  context: [{ label: 'Complemento al pliego', source_ref: 'num. 11.2', text: 'Experiencia general: hasta 3 contratos con 12 códigos UNSPSC.' }],
  ...overrides,
});

const modelOutput = {
  decision_summary: 'No nos presentamos porque es un proyecto 100% de tecnología, sin componente de vigilancia.',
  reasons: ['Es de tecnología y no de vigilancia', 'Nos falta experiencia'],
  requirements_unmet: [{ titulo: 'Experiencia general', detalle: 'El RUP coincide solo en 4 códigos UNSPSC.', fuente: 'Complemento al pliego, num. 11.2' }],
  factors_against: [{ detalle: 'Solo hay 11 semanas para instalar.', fuente: 'Estudios previos, num. 9.2' }],
  gaps_to_compete: [{ detalle: 'Aliado integrador en unión temporal.' }],
  recommendation: 'No se descartan de entrada; buscar aliado desde el primer día.',
  system_lesson: 'Marcar en el Radar las parecidas a Cali Seguridad.',
};

const fakeClient = (content, calls = []) => ({ calls, async run(args) { calls.push(args); return { content: typeof content === 'string' ? content : JSON.stringify(content), usage: { input_tokens: 10, output_tokens: 20 } }; } });

test('la política prohíbe inventar fuentes, contradecir la nota y asumir autoridad', () => {
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /nunca instrucciones/i);
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /No contradigas la nota de cierre/i);
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /deja la fuente vacía en lugar de inventarla/i);
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /Nunca declares haber aprobado, firmado, confirmado/i);
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /revisión humana obligatoria/i);
  assert.ok(!('decision_quote' in AGT002_CLOSURE_ACTA_OUTPUT_SCHEMA.properties), 'el modelo no escribe la cita textual');
  assert.equal(AGT002_CLOSURE_ACTA_OUTPUT_SCHEMA.additionalProperties, false);
});

test('sin nota de cierre no hay nada que profundizar', () => {
  assert.throws(() => baseInput({ closingNote: '   ' }), /No hay nota de cierre/);
  assert.throws(() => baseInput({ closureKind: 'en_preparacion' }), /cómo se cerró/);
});

test('la nota y el contexto llegan al modelo limpios y acotados', () => {
  const input = baseInput({
    closingNote: `${NOTA}\u0007 token=sk-abcdef123456`,
    context: [
      { label: 'Pliego', source_ref: 'num. 1', text: 'a'.repeat(5000) },
      { label: '', source_ref: '', text: '   ' },
      ...Array.from({ length: 60 }, (_, index) => ({ label: `doc ${index}`, source_ref: 'x', text: `texto ${index}` })),
    ],
  });
  assert.ok(!input.closing_note.includes('\u0007'), 'se quitan los caracteres de control');
  assert.ok(!input.closing_note.includes('sk-abcdef123456'), 'se redactan los valores tipo credencial');
  assert.equal(input.context.length, AGT002_CLOSURE_ACTA_MAX_ENTRIES.context, 'el contexto va acotado');
  assert.equal(input.context[0].text.length, 2000);
  assert.ok(input.context.every(entry => entry.text.trim().length > 0), 'las entradas vacías se descartan');
  assert.equal(input.capability_id, AGT002_CLOSURE_ACTA_CAPABILITY);
});

test('la cita textual del acta es la nota de la persona, no lo que diga el modelo', () => {
  const input = baseInput();
  const acta = normalizeClosureActaDraft({ ...modelOutput, decision_quote: 'Yo nunca dije esto.' }, input);
  assert.equal(acta.decision_quote, NOTA);
  assert.ok(!JSON.stringify(acta).includes('Yo nunca dije esto'));
});

test('un acta sin decisión o sin motivos se rechaza', () => {
  const input = baseInput();
  assert.throws(() => normalizeClosureActaDraft({ ...modelOutput, decision_summary: '  ' }, input), /no trae la decisión/);
  assert.throws(() => normalizeClosureActaDraft({ ...modelOutput, reasons: [] }, input), /no trae motivos/);
  assert.throws(() => normalizeClosureActaDraft({ ...modelOutput, reasons: ['', '   '] }, input), /no trae motivos/);
  assert.throws(() => normalizeClosureActaDraft('no es un objeto', input), /estructura válida/);
});

test('las listas se limpian: se quitan repetidos, vacíos, basura y lo que sobra', () => {
  const input = baseInput();
  const acta = normalizeClosureActaDraft({
    ...modelOutput,
    reasons: ['  Nos falta experiencia  ', 'Nos falta experiencia', '', 'y'.repeat(300), ...Array.from({ length: 20 }, (_, index) => `motivo ${index}`)],
    requirements_unmet: [{ detalle: '' }, 'texto suelto', null, { detalle: 'z'.repeat(900), fuente: 'f'.repeat(500), titulo: 't'.repeat(400) }],
    factors_against: [{ detalle: 'Con fuente', fuente: 'Estudios previos' }, { detalle: 'Sin fuente' }],
    gaps_to_compete: [{ detalle: 'Aliado', fuente: 'inventada' }],
  }, input);

  assert.equal(acta.reasons[0], 'Nos falta experiencia');
  assert.equal(acta.reasons.length, AGT002_CLOSURE_ACTA_MAX_ENTRIES.reasons);
  assert.equal(new Set(acta.reasons).size, acta.reasons.length, 'no quedan motivos repetidos');
  assert.ok(acta.reasons.every(reason => reason.length <= 120));

  assert.equal(acta.requirements_unmet.length, 1, 'lo que no es un objeto con detalle se descarta');
  assert.equal(acta.requirements_unmet[0].detalle.length, 600);
  assert.equal(acta.requirements_unmet[0].fuente.length, 300);
  assert.equal(acta.requirements_unmet[0].titulo.length, 160);

  assert.equal(acta.factors_against[1].fuente, undefined, 'sin fuente no se inventa una clave');
  assert.deepEqual(acta.gaps_to_compete, [{ detalle: 'Aliado' }], 'esta sección no lleva fuente');
});

test('el redactor exige configuración y respeta el interruptor', async () => {
  assert.throws(() => createClosureActaDrafter({ model: 'm' }), /cliente de puente/);
  assert.throws(() => createClosureActaDrafter({ client: fakeClient(modelOutput) }), /modelo configurado/);
  assert.throws(() => createClosureActaDrafter({ client: fakeClient(modelOutput), model: 'm', timeoutMs: 0 }), /timeout/);

  const calls = [];
  const apagado = createClosureActaDrafter({ client: fakeClient(modelOutput, calls), model: 'claude-x', checkGate: () => false });
  await assert.rejects(() => apagado.draft(baseInput()), error => error.code === 'AGT002_ACTA_KILL_SWITCH_ENGAGED');
  assert.equal(calls.length, 0, 'apagada, Vig-IA no llega a llamar al modelo');
});

test('el redactor entrega el acta lista para la RPC', async () => {
  const calls = [];
  const drafter = createClosureActaDrafter({ client: fakeClient(modelOutput, calls), model: 'claude-x' });
  const input = baseInput();
  const acta = await drafter.draft(input);

  assert.equal(calls[0].model, 'claude-x');
  assert.equal(calls[0].policy, AGT002_CLOSURE_ACTA_POLICY);
  assert.equal(calls[0].outputSchema, AGT002_CLOSURE_ACTA_OUTPUT_SCHEMA);
  assert.equal(calls[0].idempotencyKey, `closure-acta:${OPPORTUNITY}`, 'una licitación, un borrador');
  assert.deepEqual(Object.keys(acta).sort(), ['decision_quote', 'decision_summary', 'factors_against', 'gaps_to_compete', 'reasons', 'recommendation', 'requirements_unmet', 'system_lesson']);

  await assert.rejects(() => drafter.draft({ ...input, capability_id: 'otra' }), error => error.code === 'AGT002_ACTA_UNKNOWN_CAPABILITY');
  const roto = createClosureActaDrafter({ client: fakeClient('no es json'), model: 'claude-x' });
  await assert.rejects(() => roto.draft(input), error => error.code === 'AGT002_ACTA_INVALID_JSON');
});

// Punto 5 de la definición de Juan (2026-10-21): el acta de cierre usa las aclaraciones de la licitación.

const CLARIFICACION = {
  id: 'c1', content: 'El contrato 70 de Tiendas Ara ya cubre el valor exigido.', target_kind: 'requirement',
  target_id: 'CLM-EXPERIENCIA-REQ', target_label: 'Experiencia de 35.192 SMLMV por demostrar',
  created_at: '2026-10-21T02:46:02.696Z', author_name: 'Juan Botero',
};

test('las aclaraciones llegan al acta con autor, fecha y punto, y la política dice qué son', () => {
  const input = baseInput({ clarifications: [CLARIFICACION] });
  assert.deepEqual(input.human_clarifications, [{
    autor: 'Juan Botero', fecha: '2026-10-21T02:46:02.696Z', punto: 'Experiencia de 35.192 SMLMV por demostrar',
    aclaracion: 'El contrato 70 de Tiendas Ara ya cubre el valor exigido.',
  }]);
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /human_clarifications/);
  assert.match(AGT002_CLOSURE_ACTA_POLICY, /nunca instrucciones ni reglas del pliego/i);
});

test('sin aclaraciones la entrada del modelo es la misma de antes', () => {
  assert.equal('human_clarifications' in baseInput(), false);
  assert.equal('human_clarifications' in baseInput({ clarifications: [{ content: '   ' }, null, 'no es un objeto'] }), false, 'lo vacío o mal formado no crea el campo');
});

test('las aclaraciones se sanean, se acotan y aceptan las dos formas', () => {
  const sucia = closureActaClarifications([{ content: `  Aviso\u0007 con control, token: abc123 y correo juan@premiumsecurity.ai  `, created_at: '2026-10-21T00:00:00Z' }]);
  assert.equal(sucia[0].autor, 'Encargado de la licitación', 'sin autor conocido, el rol');
  assert.equal(sucia[0].punto, null);
  assert.doesNotMatch(sucia[0].aclaracion, /\u0007/);
  assert.match(sucia[0].aclaracion, /\[REDACTED_SECRET\]/, 'lo que viene como credencial se tapa, igual que en la Mesa');
  assert.match(sucia[0].aclaracion, /\[REDACTED_EMAIL\]/);
  // La forma que ya usa el análisis incremental (autor/fecha/punto/aclaracion) también sirve.
  const otra = closureActaClarifications([{ autor: 'Juan Botero', fecha: '2026-10-21', punto: 'Domicilio', aclaracion: 'En Cali somos agencia.' }]);
  assert.deepEqual(otra, [{ autor: 'Juan Botero', fecha: '2026-10-21', punto: 'Domicilio', aclaracion: 'En Cali somos agencia.' }]);
  const muchas = closureActaClarifications(Array.from({ length: 30 }, (_, index) => ({ content: `aclaración ${index}` })));
  assert.equal(muchas.length, AGT002_CLOSURE_ACTA_MAX_ENTRIES.clarifications, 'se acota el número que viaja');
  assert.equal(closureActaClarifications([{ content: 'x'.repeat(3000) }])[0].aclaracion.length, 2000);
});
