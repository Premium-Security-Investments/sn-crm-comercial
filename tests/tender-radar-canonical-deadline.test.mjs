// AGT-002 Radar: DANE LP-001-2026 se persiste con deadline_at='2026-10-02T00:00:00+00:00'
// (columna timestamptz) mientras raw.deadline='2026-10-02' es la fecha de calendario autorizada
// por la fuente. Al reconvertir el timestamptz a America/Bogota (UTC-5) para mostrarlo, el día
// retrocede a 01/10/2026 y el eje "tiempo" del fit calcula los días hábiles contra ese día
// equivocado. Esta prueba fija que resolveCanonicalTenderDeadline/dbTenderToPublic/
// isExpiredRadarProcess prefieren raw.deadline cuando es una fecha de calendario exacta
// (YYYY-MM-DD) y preservan deadline_at tal cual en cualquier otro caso.
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

const NOW = '2026-10-01T15:00:00.000Z'; // 2026-10-01T10:00:00 en America/Bogota

// Replica, a propósito, la aritmética de tenderDate/tenderDaysUntil de server/index.js y
// api/[...path].js (no exportadas) para comparar `pub.days`/`pub.window` sin depender del reloj
// real del entorno de pruebas: la diferencia entre dos fechas de calendario fijas separadas por un
// día es siempre exactamente 1, sin importar cuál sea "hoy".
function tenderDaysUntil(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
function tenderWindow(days) {
  if (days === null) return 'sin fecha de cierre reportada';
  if (days <= 7) return 'urgente (0-7 días)';
  if (days <= 15) return 'revisar rápido (8-15 días)';
  if (days <= 30) return 'buena ventana (16-30 días)';
  return 'ventana amplia';
}

function daneRow(o = {}) {
  return {
    stable_key: 'secop_radar:SECOP II:dane-lp-001-2026', source: 'SECOP II', section: 'hacer',
    entity: 'Departamento Administrativo Nacional de Estadística - DANE', title: 'Vigilancia armada',
    description: '', value: 2_500_000_000, city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación',
    score: 190, reasons: [], risks: [],
    deadline_at: '2026-10-02T00:00:00+00:00', raw: { deadline: '2026-10-02', ref: 'LP-001-2026' },
    ...o,
  };
}

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const { dbTenderToPublic, resolveCanonicalTenderDeadline, isExpiredRadarProcess } = await import(path);

  // resolveCanonicalTenderDeadline: prefiere raw.deadline cuando es una fecha de calendario exacta.
  assert.equal(resolveCanonicalTenderDeadline(daneRow()), '2026-10-02', `${path}: usa raw.deadline exacto`);

  // Sin raw.deadline exacto, se preserva deadline_at/deadline tal cual (semántica existente).
  assert.equal(
    resolveCanonicalTenderDeadline(daneRow({ raw: null })), '2026-10-02T00:00:00+00:00',
    `${path}: sin raw.deadline, conserva deadline_at íntegro`,
  );
  assert.equal(
    resolveCanonicalTenderDeadline(daneRow({ raw: { deadline: '2026-10-02T00:00:00Z' } })), '2026-10-02T00:00:00+00:00',
    `${path}: raw.deadline con hora (no YYYY-MM-DD exacto) no es autoridad, conserva deadline_at`,
  );
  assert.equal(
    resolveCanonicalTenderDeadline(daneRow({ raw: { deadline: 'no-es-una-fecha' } })), '2026-10-02T00:00:00+00:00',
    `${path}: raw.deadline inválido no es autoridad, conserva deadline_at`,
  );
  assert.equal(
    resolveCanonicalTenderDeadline({ deadline: '2026-10-05' }), '2026-10-05',
    `${path}: tender vivo sin deadline_at cae a .deadline (semántica existente)`,
  );

  // dbTenderToPublic: el campo público `deadline` es la fecha canónica, no el timestamptz crudo.
  const pub = dbTenderToPublic(daneRow(), { nowIso: NOW });
  assert.equal(pub.deadline, '2026-10-02', `${path}: deadline público es 2026-10-02, no el día Bogotá anterior`);
  assert.notEqual(pub.deadline, '2026-10-01', `${path}: deadline público nunca retrocede a 2026-10-01`);
  assert.equal(pub.raw, undefined, `${path}: el payload crudo de la fuente nunca llega al cliente`);

  // days/window se derivan de esa misma fecha canónica (exactamente 1 día después del equivalente
  // calculado sobre el día Bogotá erróneo, sin importar cuál sea "hoy" en el entorno de pruebas).
  const wrongDayDays = tenderDaysUntil('2026-10-01');
  assert.equal(pub.days, wrongDayDays + 1, `${path}: days se calcula sobre 2026-10-02, un día después del día Bogotá erróneo`);
  assert.equal(pub.window, tenderWindow(pub.days), `${path}: window es consistente con days`);

  // fit (eje "tiempo"): evaluateTenderFit recibe nowIso explícito, así que esta parte es
  // determinística y no depende del reloj real del entorno de pruebas.
  const tiempoReason = pub.fit.reasons.find(r => r.axis === 'tiempo');
  assert.ok(tiempoReason, `${path}: el fit siempre expone una razón del eje tiempo`);
  assert.ok(
    tiempoReason.detail.includes('2026-10-02'),
    `${path}: el detalle del eje tiempo referencia el cierre 2026-10-02, no 2026-10-01: ${tiempoReason.detail}`,
  );
  assert.ok(
    !tiempoReason.detail.includes('2026-10-01'),
    `${path}: el detalle del eje tiempo no debe referenciar el día Bogotá anterior: ${tiempoReason.detail}`,
  );

  // isExpiredRadarProcess: también debe resolver la fecha canónica, no solo deadline_at. Una fila
  // con deadline_at ya vencido pero raw.deadline futuro y exacto no debe tratarse como vencida.
  const staleDeadlineAtFutureRaw = daneRow({ deadline_at: '2020-01-01T00:00:00+00:00', raw: { deadline: '2030-01-01' } });
  assert.equal(isExpiredRadarProcess(staleDeadlineAtFutureRaw), false, `${path}: raw.deadline futuro exacto evita un vencimiento falso`);

  const pastDeadlineNoRaw = daneRow({ deadline_at: '2020-01-01T00:00:00+00:00', raw: null });
  assert.equal(isExpiredRadarProcess(pastDeadlineNoRaw), true, `${path}: sin raw.deadline, deadline_at vencido sigue marcando vencido (semántica existente)`);
}

console.log('tender-radar-canonical-deadline: OK');
