// CRM comercial — regla pura de comportamiento por comercial (src/vigia/commercial-behavior.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BEHAVIOR_RULES,
  bogotaDaysSince,
  bogotaWeekStart,
  buildCommercialBehavior,
  monthlyGoalCompliance,
} from '../src/vigia/commercial-behavior.js';

// Miércoles 7 de octubre de 2026, 10:00 en Bogotá (15:00 UTC).
const NOW = new Date('2026-10-07T15:00:00Z');
const at = (day, hour = '15:00:00') => `${day}T${hour}Z`;

const ANA = 'ana';
const BETO = 'beto';
const CARO = 'caro';
const DANI = 'dani';

function fixture() {
  const opportunities = [
    // Ana: dos activas al día y una licitación (AGT-002) que no cuenta.
    { id: 'a1', owner_id: ANA, service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: at('2026-10-09') },
    { id: 'a2', owner_id: ANA, service_type_code: 'seguridad_fisica', stage_code: 'negociacion', next_action_at: at('2026-10-07') },
    { id: 'a3', owner_id: ANA, service_type_code: 'licitacion_publica', stage_code: 'prospecto', next_action_at: null },
    { id: 'a4', owner_id: ANA, service_type_code: 'seguridad_fisica', stage_code: 'aprobado', offer_value: 30, approved_at: at('2026-10-02') },
    // Beto: una pendiente (vencida) y una al día → atrasado.
    { id: 'b1', owner_id: BETO, service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: at('2026-10-01') },
    { id: 'b2', owner_id: BETO, service_type_code: 'tecnologia', stage_code: 'prospecto', next_action_at: at('2026-10-20') },
    // Caro: sin actividad hace tiempo.
    { id: 'c1', owner_id: CARO, service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: at('2026-10-20') },
    // Dani: congelada (no cuenta como activa ni pendiente).
    { id: 'd1', owner_id: DANI, service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: at('2026-09-01'), frozen_until: '2026-11-01' },
  ];
  const interactions = [
    { opportunity_id: 'a1', created_by: ANA, interaction_type: 'llamada', created_at: at('2026-10-06') }, // esta semana
    { opportunity_id: 'a2', created_by: ANA, interaction_type: 'correo', created_at: at('2026-10-05', '05:30:00') }, // lunes 00:30 Bogotá
    { opportunity_id: 'a2', created_by: ANA, interaction_type: 'reunion', created_at: at('2026-10-05', '04:30:00') }, // domingo 23:30 Bogotá
    { opportunity_id: 'a1', created_by: ANA, interaction_type: 'whatsapp', created_at: at('2026-09-20') }, // 30 días
    { opportunity_id: 'a1', created_by: ANA, interaction_type: 'nota', created_at: at('2026-08-01') }, // fuera de 30 días
    { opportunity_id: 'a3', created_by: ANA, interaction_type: 'llamada', created_at: at('2026-10-07') }, // licitación: no cuenta
    { opportunity_id: 'a1', created_by: ANA, interaction_type: 'cambio_estado', created_at: at('2026-10-07') }, // tipo no cuenta
    { opportunity_id: 'a1', created_by: BETO, interaction_type: 'llamada', created_at: at('2026-10-07') }, // autor ajeno a la oportunidad: cuenta para Beto
    { opportunity_id: 'c1', created_by: CARO, interaction_type: 'llamada', created_at: at('2026-09-10') },
  ];
  const decisionLogs = [
    { opportunity_id: 'a2', changed_by: ANA, field_name: 'decision', created_at: at('2026-10-06') },
    { opportunity_id: 'a2', changed_by: ANA, field_name: 'decision', created_at: at('2026-10-04') }, // semana anterior
    { opportunity_id: 'a3', changed_by: ANA, field_name: 'decision', created_at: at('2026-10-06') }, // licitación
    { opportunity_id: 'a2', changed_by: ANA, field_name: 'stage_code', created_at: at('2026-10-06') }, // otro campo
  ];
  const lastSeen = [
    { profile_id: ANA, last_seen_at: at('2026-10-07') },
    { profile_id: CARO, last_seen_at: at('2026-09-25') },
  ];
  const goals = [
    { user_id: ANA, period_month: '2026-10-01', sales_budget: 100 },
    { user_id: ANA, period_month: '2026-09-01', sales_budget: 999 },
  ];
  const salespeople = [{ id: DANI, full_name: 'Dani' }, { id: ANA, full_name: 'Ana' }, { id: CARO, full_name: 'Caro' }, { id: BETO, full_name: 'Beto' }];
  return { salespeople, opportunities, interactions, decisionLogs, lastSeen, goals, now: NOW };
}

test('reglas versionadas y semana desde el lunes en hora de Bogotá', () => {
  assert.deepEqual({ ...BEHAVIOR_RULES }, { inactiveDays: 7, agendaOkPct: 70, version: 'behavior-v1' });
  assert.equal(Object.isFrozen(BEHAVIOR_RULES), true);
  assert.equal(bogotaWeekStart(NOW), '2026-10-05');
  assert.equal(bogotaWeekStart(new Date('2026-10-05T04:59:00Z')), '2026-09-28', 'domingo 23:59 Bogotá pertenece a la semana anterior');
  assert.equal(bogotaWeekStart(new Date('2026-10-05T05:00:00Z')), '2026-10-05');
  assert.equal(bogotaDaysSince(at('2026-09-30'), NOW), 7);
  assert.equal(bogotaDaysSince(null, NOW), null);
});

test('cuenta seguimientos, decisiones y pendientes sólo del pipeline comercial y del autor', () => {
  const report = buildCommercialBehavior(fixture());
  const ana = report.rows.find(row => row.profileId === ANA);
  assert.equal(report.weekStart, '2026-10-05');
  assert.equal(ana.followUpsWeek, 2, 'llamada del martes y correo del lunes 00:30; no el domingo 23:30 ni la licitación ni cambio_estado');
  assert.equal(ana.followUps30d, 4);
  assert.equal(ana.decisionsWeek, 1);
  assert.equal(ana.pendingDecisions, 0);
  assert.equal(ana.activeOpportunities, 2);
  assert.equal(ana.agendaPct, 100);
  assert.equal(ana.lastFollowUpAt, at('2026-10-06'));
  assert.equal(ana.daysSinceFollowUp, 1);
  assert.equal(ana.goalPct, 30, 'aprobado del mes (30) contra la meta del mes (100)');
  assert.equal(ana.status, 'al_dia');
  const beto = report.rows.find(row => row.profileId === BETO);
  assert.equal(beto.followUpsWeek, 1);
  assert.equal(beto.pendingDecisions, 1);
  assert.equal(beto.agendaPct, 50);
  assert.equal(beto.status, 'atrasado');
  assert.match(beto.reason, /1 oportunidad pendiente de decidir y agenda al día en 50% \(mínimo 70%\)/);
});

test('inactivo exige sin seguimientos y sin ingreso conocido en 7 días; ingreso desconocido no es inactivo', () => {
  const report = buildCommercialBehavior(fixture());
  const caro = report.rows.find(row => row.profileId === CARO);
  assert.equal(caro.status, 'inactivo');
  assert.equal(caro.daysSinceSeen, 12);
  const dani = report.rows.find(row => row.profileId === DANI);
  assert.equal(dani.lastSeenAt, null);
  assert.equal(dani.lastFollowUpAt, null);
  assert.equal(dani.status, 'al_dia', 'sin registro de ingreso no se marca inactivo');
  assert.equal(dani.activeOpportunities, 0, 'congelada fuera del pipeline activo');
  assert.equal(dani.agendaPct, null);
  assert.match(dani.reason, /Aún no hay registro/);
  const seenRecently = buildCommercialBehavior({ ...fixture(), lastSeen: [{ profile_id: CARO, last_seen_at: at('2026-10-06') }] });
  assert.notEqual(seenRecently.rows.find(row => row.profileId === CARO).status, 'inactivo', 'si entró al CRM esta semana no está inactivo');
});

test('ordena inactivos, luego atrasados, luego por pendientes y nombre', () => {
  const report = buildCommercialBehavior(fixture());
  assert.deepEqual(report.rows.map(row => row.profileId), [CARO, BETO, ANA, DANI]);
});

test('un admin con oportunidades propias aparece sólo si tiene una oportunidad comercial activa', () => {
  const input = fixture();
  input.salespeople = [...input.salespeople, { id: 'juan', full_name: 'Juan', role: 'admin' }, { id: 'luis', full_name: 'Luis', role: 'admin' }];
  input.opportunities = [...input.opportunities,
    { id: 'j1', owner_id: 'juan', service_type_code: 'seguridad_fisica', stage_code: 'prospecto', next_action_at: at('2026-10-10') },
    { id: 'l1', owner_id: 'luis', service_type_code: 'licitacion_publica', stage_code: 'prospecto', next_action_at: at('2026-10-10') },
    { id: 'l2', owner_id: 'luis', service_type_code: 'seguridad_fisica', stage_code: 'aprobado' }];
  const ids = buildCommercialBehavior(input).rows.map(row => row.profileId);
  assert.ok(ids.includes('juan'));
  assert.ok(!ids.includes('luis'), 'sin oportunidad comercial activa no aparece');
  assert.ok(ids.includes(DANI), 'un comercial sin oportunidades activas sí aparece');
  assert.ok(buildCommercialBehavior(input).rows.every(row => !('role' in row)));
});

test('nunca devuelve el texto de los seguimientos', () => {
  const input = fixture();
  input.interactions = input.interactions.map(row => ({ ...row, notes: 'CONFIDENCIAL cliente dijo X' }));
  const report = buildCommercialBehavior(input);
  assert.doesNotMatch(JSON.stringify(report), /CONFIDENCIAL|notes/);
});

test('cumplimiento del mes suma aprobadas de AGT-003 del mes de Bogotá', () => {
  const { opportunities, goals } = fixture();
  assert.deepEqual(monthlyGoalCompliance({ opportunities, goals, month: '2026-10' }), { approved: 30, budget: 100, pct: 30 });
  assert.deepEqual(monthlyGoalCompliance({ opportunities, goals: [], month: '2026-10' }), { approved: 0, budget: 0, pct: null });
  const withoutGoal = [...opportunities, { id: 'x', owner_id: BETO, service_type_code: 'seguridad_fisica', stage_code: 'aprobado', offer_value: 500, approved_at: at('2026-10-03') }];
  assert.deepEqual(monthlyGoalCompliance({ opportunities: withoutGoal, goals, month: '2026-10' }), { approved: 30, budget: 100, pct: 30 }, 'el total del equipo sólo cuenta a quien tiene meta');
  assert.deepEqual(monthlyGoalCompliance({ opportunities: withoutGoal, goals, month: '2026-10', ownerId: BETO }), { approved: 500, budget: 0, pct: null });
});

test('el módulo es puro: sin red, base de datos, reloj implícito ni last_sign_in_at', () => {
  const source = readFileSync(new URL('../src/vigia/commercial-behavior.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|supabase|process\.env|from ['"]node:/);
  assert.match(source, /auth\.users\.last_sign_in_at/, 'el comentario documenta por qué no se usa last_sign_in_at');
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ''), /last_sign_in_at/, 'el código no lee last_sign_in_at; sólo el comentario lo prohíbe');
});
