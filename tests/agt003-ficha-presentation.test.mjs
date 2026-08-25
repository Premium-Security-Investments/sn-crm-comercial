import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// AGT-003 — refinamiento de la ficha comercial (bloque 1).
//
// Pruebas conductuales sobre el módulo puro extraído `src/vigia/opportunity-ficha-presentation.ts`.
// No tocan AGT-002, ni el contrato del copiloto, ni la persistencia: sólo presentación.
//
// Conducta exigida (RED antes de producción):
//  1. La antigüedad del último seguimiento y el vencimiento de la próxima gestión se calculan
//     desde la MISMA referencia temporal (inicio de día), de modo que la misma fecha fuente no
//     produzca 34 en una tarjeta y 35 en otra.
//  2. El copy es natural: `Vencida hace N días`, nunca `día(s)` ni la repetición
//     `Vencida · … vencida`.
//  3. Cierre estimado vencido y contacto decisor por completar son estados accionables.
//  4. El registro migrado se presenta con tipo inferido, autor `Migrado / sistema` y contenido
//     original útil, sin repetir `Seguimiento migrado:` y sin mutar el objeto fuente.

const entry = new URL('../src/vigia/opportunity-ficha-presentation.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  calendarDaysBetween,
  humanDayCount,
  followUpAgeLabel,
  nextActionCardState,
  expectedCloseCardState,
  decisionMakerCardState,
  presentFollowUpEntry,
} = await import(moduleUrl);

// --- 1. referencia temporal única ------------------------------------------------------------
// Todos los instantes se fijan a mediodía UTC para que el día de calendario local sea el mismo
// en cualquier zona razonable del runner (UTC-11..UTC+11), incluida América/Bogotá (UTC-5).
const now = new Date('2026-08-25T12:00:00.000Z');
const thirtyFourDaysAgo = '2026-07-22T12:00:00.000Z';

assert.equal(calendarDaysBetween(thirtyFourDaysAgo, now), 34, 'la distancia se mide entre días de calendario, no entre instantes');
assert.equal(calendarDaysBetween(null, now), null);
assert.equal(calendarDaysBetween('no-es-fecha', now), null);
assert.equal(calendarDaysBetween('2026-08-25T10:00:00.000Z', now), 0, 'el mismo día es 0');
assert.equal(calendarDaysBetween('2026-08-26T12:00:00.000Z', now), -1, 'el futuro es negativo');
// Una columna `date` de Postgres se lee como día de calendario literal, sin corrimiento de zona.
assert.equal(calendarDaysBetween('2026-07-22', now), 34);

// La antigüedad y el vencimiento leen la misma fecha fuente y deben coincidir en N.
const ageLabel = followUpAgeLabel(thirtyFourDaysAgo, now);
const overdue = nextActionCardState({ stage_code: 'propuesta', next_action_at: thirtyFourDaysAgo }, now);
assert.equal(ageLabel, 'Hace 34 días');
assert.equal(overdue.detail, 'Vencida hace 34 días');
assert.equal(
  Number(/(\d+)/.exec(ageLabel)[1]),
  Number(/(\d+)/.exec(overdue.detail)[1]),
  'desfase 34/35: antigüedad y vencimiento deben derivar del mismo corte temporal',
);

// --- 2. copy natural --------------------------------------------------------------------------
assert.equal(humanDayCount(1), '1 día');
assert.equal(humanDayCount(2), '2 días');
assert.equal(followUpAgeLabel(null, now), 'Sin registro');
assert.equal(followUpAgeLabel('2026-08-25T10:00:00.000Z', now), 'Hoy');
assert.equal(followUpAgeLabel('2026-08-24T12:00:00.000Z', now), 'Ayer');
assert.equal(followUpAgeLabel('2026-08-23T12:00:00.000Z', now), 'Hace 2 días');

const overdueOneDay = nextActionCardState({ stage_code: 'propuesta', next_action_at: '2026-08-24T12:00:00.000Z' }, now);
assert.equal(overdueOneDay.detail, 'Vencida hace 1 día', 'singular natural, nunca "1 día(s)"');
assert.equal(overdueOneDay.code, 'overdue');
assert.equal(overdueOneDay.className, 'is-critical');
for (const state of [overdue, overdueOneDay]) {
  assert.doesNotMatch(state.detail, /día\(s\)/, 'el copy no puede usar "día(s)"');
  assert.doesNotMatch(state.detail, /Vencida[\s\S]*vencida/, 'no se repite "Vencida … vencida"');
}

assert.deepEqual(
  nextActionCardState({ stage_code: 'propuesta', next_action_at: '2026-08-25T10:00:00.000Z' }, now),
  { code: 'today', label: 'Hoy', detail: 'Gestionar hoy', tone: 'attention', className: 'is-attention' },
);
assert.equal(nextActionCardState({ stage_code: 'propuesta', next_action_at: '2026-08-26T12:00:00.000Z' }, now).detail, 'En 1 día');
assert.equal(nextActionCardState({ stage_code: 'propuesta', next_action_at: '2026-08-27T12:00:00.000Z' }, now).detail, 'En 2 días');
assert.equal(nextActionCardState({ stage_code: 'propuesta', next_action_at: '2026-09-30T12:00:00.000Z' }, now).code, 'scheduled');
assert.equal(nextActionCardState({ stage_code: 'propuesta', next_action_at: null }, now).code, 'missing');
assert.equal(nextActionCardState({ stage_code: 'propuesta', next_action_at: null }, now).className, 'is-critical');
assert.equal(nextActionCardState({ stage_code: 'aprobado', next_action_at: null }, now).code, 'closed');
assert.equal(nextActionCardState({ stage_code: 'perdido', next_action_at: thirtyFourDaysAgo }, now).code, 'closed');

// --- 3. cierre estimado y contacto decisor ----------------------------------------------------
const closeOverdue = expectedCloseCardState('2026-07-22', now);
assert.equal(closeOverdue.code, 'overdue');
assert.equal(closeOverdue.detail, 'Vencido hace 34 días');
assert.equal(closeOverdue.className, 'is-critical');
assert.doesNotMatch(closeOverdue.detail, /día\(s\)/);
assert.equal(expectedCloseCardState('2026-08-25', now).detail, 'Cierra hoy');
assert.equal(expectedCloseCardState('2026-08-26', now).detail, 'En 1 día');
assert.equal(expectedCloseCardState('2026-12-01', now).code, 'scheduled');
assert.equal(expectedCloseCardState(null, now).code, 'missing');
assert.equal(expectedCloseCardState(null, now).detail, 'Sin fecha de cierre');
assert.equal(expectedCloseCardState(null, now).className, 'is-attention');

const decisionPending = decisionMakerCardState({ name: '', email: null, phone: '   ' });
assert.equal(decisionPending.code, 'pending');
assert.equal(decisionPending.detail, 'Complete el contacto decisor');
assert.equal(decisionPending.className, 'is-attention');
const decisionPartial = decisionMakerCardState({ name: 'Ana Ruiz', email: '', phone: '' });
assert.equal(decisionPartial.code, 'partial');
assert.equal(decisionPartial.detail, 'Falta correo y teléfono');
assert.equal(decisionPartial.className, 'is-attention');
const decisionComplete = decisionMakerCardState({ name: 'Ana Ruiz', email: 'a@b.co', phone: '3001112233' });
assert.equal(decisionComplete.code, 'complete');
assert.equal(decisionComplete.detail, 'Contacto verificado');
assert.equal(decisionComplete.className, 'is-ok');

// --- 4. registro migrado ----------------------------------------------------------------------
const migratedSource = Object.freeze({
  id: 'observacion-migrada',
  interaction_type: 'nota',
  notes: 'Seguimiento migrado: Llamada 4 24 horas',
  occurred_at: '2024-03-04T12:00:00.000Z',
  actor_label: 'Migrado / sistema',
  psi_sales_profiles: null,
});
const migrated = presentFollowUpEntry(migratedSource);
assert.equal(migrated.migrated, true);
assert.equal(migrated.typeLabel, 'Llamada', 'el tipo se infiere del texto migrado');
assert.equal(migrated.authorLabel, 'Migrado / sistema');
assert.equal(migrated.content, '4 24 horas', 'se conserva el contenido original útil sin la redundancia técnica');
assert.doesNotMatch(migrated.content, /Seguimiento migrado/i);
assert.equal(migratedSource.notes, 'Seguimiento migrado: Llamada 4 24 horas', 'la presentación no muta el objeto fuente');
assert.equal(migrated.occurredAt, '2024-03-04T12:00:00.000Z', 'la fecha fuente se preserva intacta');

assert.equal(presentFollowUpEntry({ ...migratedSource, notes: 'Seguimiento migrado: correo electrónico seguimiento de cotización' }).typeLabel, 'Correo');
assert.equal(presentFollowUpEntry({ ...migratedSource, notes: 'Seguimiento migrado: Reunión en sede' }).content, 'en sede');
assert.equal(presentFollowUpEntry({ ...migratedSource, notes: 'Seguimiento migrado: Llamada' }).content, 'Llamada', 'si no queda contenido útil se conserva el texto original');
assert.equal(presentFollowUpEntry({ ...migratedSource, notes: 'Seguimiento migrado: whatsapp - sin respuesta' }).typeLabel, 'WhatsApp');

const regular = presentFollowUpEntry({
  id: 'int-1', interaction_type: 'reunion', notes: 'Visita técnica realizada.',
  occurred_at: '2026-08-20T14:00:00.000Z', actor_label: null, psi_sales_profiles: { full_name: 'Ana Ruiz' },
});
assert.equal(regular.migrated, false);
assert.equal(regular.typeLabel, 'Reunión');
assert.equal(regular.authorLabel, 'Ana Ruiz');
assert.equal(regular.content, 'Visita técnica realizada.');

const anonymous = presentFollowUpEntry({ id: 'int-2', interaction_type: 'nota', notes: 'Nota suelta.', occurred_at: '2026-08-20T14:00:00.000Z' });
assert.equal(anonymous.authorLabel, 'Migrado / sistema');
assert.equal(anonymous.migrated, false, 'un registro sin autor no es, por sí solo, un registro migrado');

console.log('AGT-003 ficha comercial presentation checks passed');
