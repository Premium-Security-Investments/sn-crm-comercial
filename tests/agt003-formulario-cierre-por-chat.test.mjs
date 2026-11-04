// AGT-003 — formulario de cierre dictado al chat (etapa 3, primera mitad; Juan 2026-10-23 y 2026-11-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_ACTION_TYPES, CHAT_CLOSURE_MAX_POSTS, chatRegistroOutputSchema, describeChatAction, normalizeChatOutput } from '../src/vigia/chat-registro.js';
import { CLOSURE_FORM_FIELD_KEYS } from '../src/vigia/closure-form.js';
import { buildChatInput, CHAT_POLICY } from '../verticales/comercial/agt003-chat-registro.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const refs = new Map([['o1', { id: 'opp-1', label: 'Acme', stageOrder: 4 }]]);
const stages = [{ code: 'aprobado', name: 'Aprobado', stage_order: 5, is_terminal: true }];
const run = acciones => normalizeChatOutput({ respuesta: 'Listo.', acciones }, { refs, today: '2026-11-03', stages });

test('el contrato de salida admite el formulario con las claves del catálogo, puestos y direcciones', () => {
  assert.ok(CHAT_ACTION_TYPES.includes('formulario_cierre'));
  const item = chatRegistroOutputSchema([]).properties.acciones.items.properties;
  assert.deepEqual(Object.keys(item.formulario.properties).sort(), [...CLOSURE_FORM_FIELD_KEYS].sort());
  assert.equal(item.formulario.additionalProperties, false);
  assert.equal(item.formulario.properties.withholding_agent.type, 'boolean');
  assert.deepEqual(item.formulario.properties.tax_regime.enum, ['simplificado', 'comun']);
  assert.equal(item.puestos.maxItems, CHAT_CLOSURE_MAX_POSTS);
  assert.equal(item.puestos.items.additionalProperties, false);
});

test('se limpia con la misma regla de la pantalla: lo inventado no pasa y lo vacío no se propone', () => {
  const out = run([
    { tipo: 'formulario_cierre', ref: 'o1', formulario: { legal_rep_name: '  Ana   Pérez ', inventado: 'x', tax_regime: 'otro', service_start_date: '2026-12-01' },
      puestos: [{ description: 'Portería', shift_start: '06:00', shift_end: '18:00', guards_required: 1, armed: true, service_value: 9500000 }, {}],
      sedes: [{ address: 'Cra 7 # 10-20', city: 'Pereira' }, {}] },
    { tipo: 'formulario_cierre', ref: 'o1', formulario: { legal_rep_id_number: '42.000.111' } },
    { tipo: 'formulario_cierre', ref: 'o1', formulario: {} },
    { tipo: 'formulario_cierre', ref: 'o9', formulario: { legal_rep_name: 'Otro' } },
  ]);
  assert.equal(out.acciones.length, 1, 'una sola acción por oportunidad; la de una referencia ajena no pasa');
  const [action] = out.acciones;
  assert.deepEqual(action.formulario, { legal_rep_name: 'Ana Pérez', service_start_date: '2026-12-01', legal_rep_id_number: '42.000.111' });
  assert.equal(action.puestos.length, 1);
  assert.equal(action.sedes.length, 1);
  assert.match(out.avisos.join(' '), /Régimen tiene un valor que el formato no reconoce/);
});

test('el formulario va antes de ganar, y la tarjeta lo dice en palabras', () => {
  const out = run([
    { tipo: 'mover_etapa', ref: 'o1', decision: 'avanzar', etapa: 'aprobado', nota: 'Firmaron el contrato.' },
    { tipo: 'formulario_cierre', ref: 'o1', formulario: { tax_regime: 'comun', large_taxpayer: false } },
  ]);
  assert.deepEqual(out.acciones.map(action => action.tipo), ['formulario_cierre', 'mover_etapa']);
  assert.deepEqual(describeChatAction(out.acciones[0], { labelFor: () => 'Acme' }).lineas, ['Formulario de cierre:', 'Régimen: Común', 'Gran contribuyente: No']);
});

test('el servidor guarda por la misma puerta que la pantalla y agrega los puestos dictados', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.match(src, /async function saveClosureFormForProfile\(database, currentProfile, id, body, \{ append = false \} = \{\}\)/);
    assert.match(src, /res\.json\(await saveClosureFormForProfile\(database, currentProfile, id, req\.body\)\);/);
    assert.match(src, /if \(action\.tipo === 'formulario_cierre'\) \{\n.*\n {4}await saveClosureFormForProfile\(database, profile, action\.opportunity_id, \{ form: action\.formulario \|\| \{\}, posts: action\.puestos \|\| \[\], sites: action\.sedes \|\| \[\] \}, \{ append: true \}\);/);
    assert.match(src, /append \? renumber\(\[\.\.\.previous\.posts, \.\.\.cleanPosts\]\) : cleanPosts/);
  }
});

test('Vig-IA Comercial conoce la acción y el catálogo', () => {
  assert.match(CHAT_POLICY, /- formulario_cierre: /);
  assert.match(CHAT_POLICY, /nunca inventes un NIT, una cédula ni un valor/);
  const input = buildChatInput({ today: '2026-11-03', rows: [] });
  assert.equal(input.formulario_de_cierre_campos.length, CLOSURE_FORM_FIELD_KEYS.length);
  assert.deepEqual(input.formulario_de_cierre_campos.find(field => field.clave === 'tax_regime'), { clave: 'tax_regime', etiqueta: 'Régimen', tipo: 'opcion', opciones: ['simplificado', 'comun'] });
});
