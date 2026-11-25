// Juan, 2026-11-25, con un cliente real: pidió «active la oportunidad y agéndeme una llamada el lunes 30»; Vig-IA contestó que
// ya estaba abierta y sólo movió la fecha (seguía congelada hasta febrero, fuera de Mi día). Y el borrador de WhatsApp
// dijo «no hay decisor verificado» aunque la ficha tiene nombre y cargo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgt003Facts } from '../verticales/comercial/agt003-copilot-input.js';
import { buildChatInput } from '../verticales/comercial/agt003-chat-registro.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('el copiloto recibe el decisor, su cargo y si sigue congelada', () => {
  const facts = buildAgt003Facts({ id: 'o1', company_name: 'Cliente', stage: 'Negociación', decision_maker: 'Contacto Uno', decision_maker_title: 'Gerente General', frozen_until: '2027-02-11' }, '2026-11-25');
  const byField = Object.fromEntries(facts.map(fact => [fact.field, fact.value]));
  assert.equal(byField.decision_maker, 'Contacto Uno');
  assert.equal(byField.decision_maker_title, 'Gerente General');
  assert.equal(byField.frozen_until, '2027-02-11');
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.match(src, /decision_maker: row\.decision_maker_name \|\| null,\n    decision_maker_title: contact\?\.decision_maker_title \|\| null,\n    frozen_until: isFrozen\(row, now\(\)\) \? row\.frozen_until : null,/);
    assert.match(src, /const VIGIA_COPILOT_OPPORTUNITY_SELECT = '[^']*decision_maker_name,frozen_until'/);
  }
});

test('el chat ve que la oportunidad está congelada', () => {
  const input = buildChatInput({ today: '2026-11-25', comercial: 'Juan', canCreate: true, rows: [{ ref: 'o1', opportunity: { company_name: 'Cliente Dos', frozen_until: '2027-02-11', next_action_at: '2027-02-11' } }], services: [], stages: [], lossReasons: [], competitors: [], history: [], mensaje: 'active la oportunidad' });
  const text = JSON.stringify(input);
  assert.match(text, /"congelada_hasta":"2027-02-11"/);
  const prompt = read('../verticales/comercial/agt003-chat-registro.js');
  assert.match(prompt, /el proximo_seguimiento la descongela al confirmarse: dilo así en la respuesta, nunca digas que ya estaba activa/);
});

test('agendar un contacto desde el chat descongela, con constancia en la auditoría', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    const block = src.slice(src.indexOf("if (action.tipo === 'proximo_seguimiento') {"), src.indexOf("if (action.tipo === 'actualizar_datos') {"));
    assert.match(block, /const wasFrozen = isFrozen\(current\);/);
    assert.match(block, /frozen_until: null, frozen_reason: null, frozen_at: null, frozen_by: null/);
    assert.match(block, /psi_sales_opportunity_audit_logs'\)\.insert\(\{ opportunity_id: action\.opportunity_id, changed_by: profile\.id, field_name: 'frozen_until'/);
  }
});
