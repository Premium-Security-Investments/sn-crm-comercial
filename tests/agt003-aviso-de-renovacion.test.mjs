// AGT-003 — aviso de renovación en Mi día (Juan, 2026-11-03) y clasificación de los clientes actuales (migración 174).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { daysUntil, RENEWAL_WINDOW_DAYS, renewalPhrase, renewalsDue } from '../src/vigia/renewal-alerts.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = new Date('2026-11-04T03:00:00Z'); // 3 de noviembre, 10 p. m. en Bogotá: el día lo pone Bogotá, no UTC
const base = { service_type_code: 'seguridad_fisica', customer_segment: 'cliente_actual', client_deal_type: 'renovacion', stage_code: 'envio_oferta' };
const opp = (name, end, extra = {}) => ({ ...base, id: name, company_name: name, current_contract_end_date: end, ...extra });

test('días hasta el vencimiento, por día de Bogotá', () => {
  assert.equal(RENEWAL_WINDOW_DAYS, 90);
  assert.equal(daysUntil('2026-11-03', NOW), 0);
  assert.equal(daysUntil('2026-11-04', NOW), 1);
  assert.equal(daysUntil('2026-10-31', NOW), -3);
  assert.equal(daysUntil('2027-02-01', NOW), 90);
});

test('la frase dice cuándo vence, o cuándo venció', () => {
  assert.equal(renewalPhrase(-1, '2026-11-02'), 'El contrato venció el 02/11/2026 (hace 1 día)');
  assert.equal(renewalPhrase(0, '2026-11-03'), 'El contrato vence hoy');
  assert.equal(renewalPhrase(1, '2026-11-04'), 'El contrato vence mañana');
  assert.equal(renewalPhrase(20, '2026-11-23'), 'El contrato vence el 23/11/2026 (en 20 días)');
});

test('entran las renovaciones abiertas que vencen en 90 días o ya vencieron, la más urgente primero', () => {
  const rows = [
    opp('Lejana', '2027-02-02'),                                   // 91 días: todavía no
    opp('Al límite', '2027-02-01'),                                // 90 días: sí
    opp('Vencida', '2026-10-20'),
    opp('Pronto', '2026-11-10'),
    opp('Congelada', '2026-12-01', { frozen_until: '2027-01-15' }), // congelar no detiene el contrato
    opp('Ganada', '2026-11-10', { stage_code: 'aprobado' }),
    opp('Servicio nuevo', '2026-11-10', { client_deal_type: 'servicio_nuevo' }),
    opp('Cliente nuevo', '2026-11-10', { customer_segment: 'cliente_nuevo' }),
    opp('Licitación', '2026-11-10', { service_type_code: 'licitacion_publica' }),
    opp('Eliminación pedida', '2026-11-10', { delete_requested_at: '2026-11-01T00:00:00Z' }),
    opp('Sin fecha', null),
  ];
  assert.deepEqual(renewalsDue(rows, NOW).map(item => item.opportunity.company_name), ['Vencida', 'Pronto', 'Congelada', 'Al límite']);
  assert.equal(renewalsDue(rows, NOW)[0].daysLeft, -14);
});

test('Mi día muestra el aviso antes de "Esta semana"', () => {
  const ui = read('../src/main.tsx');
  assert.match(ui, /const renewals = useMemo\(\(\) => renewalsDue\(opportunities, now\), \[opportunities, now\]\);/);
  assert.match(ui, /<RenewalsDue items=\{renewals\} \/>\n {10}<WeekList upcoming=\{weekRows\} \/>/);
  const card = read('../src/vigia/OpportunityDecision.tsx');
  assert.match(card, /aria-label="Renovaciones por vencer"/);
  assert.match(card, /daysLeft <= 30 \? ' is-urgent' : ''/);
});

test('migración 174: clasifica sin pisar lo hecho a mano y deja rastro', () => {
  const up = read('../supabase/migrations/174_crm_clientes_actuales_clasificados.sql');
  const down = read('../supabase/rollbacks/174_crm_clientes_actuales_clasificados_rollback.sql');
  assert.match(up, /and o\.customer_segment = 'cliente_actual'\n {5}and o\.client_deal_type is null/);
  assert.equal((up.match(/'renovacion'\),/g) || []).length, 6);
  assert.match(up, /o\.service_type_code = 'proyecto'/);
  assert.match(up, /'Migración 174: clasificación inferida de la observación y el servicio de la oportunidad'/);
  assert.match(down, /and o\.client_deal_type = a\.new_value;/, 'el rollback no deshace lo que alguien cambió después');
});
