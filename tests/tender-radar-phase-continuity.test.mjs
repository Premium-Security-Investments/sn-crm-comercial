// Radar Corte 1 — continuidad de fase sucesora SECOP, proyección pública.
// Fija el contrato de dbTenderToPublic para la tarjeta del Radar:
//   (1) `known_phases` se deriva de `row.raw.phase_continuity.known_phases` cuando existe, sin
//       exponer jamás el resto de `row.raw` (el payload crudo del proveedor permanece oculto).
//   (2) `identity_review_required` se deriva de `row.raw.phase_identity_review`, para que la UI
//       pueda mostrar "Identidad por validar" fuera del flujo normal de conversión.
//   (3) Ausente cualquiera de las dos señales, la proyección cae de forma segura (lista vacía /
//       falso), sin lanzar y sin exponer `raw`.
// No cambia filtros, orden, esquema ni migraciones.
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

function baseRow(o = {}) {
  return {
    stable_key: 's1', source: 'SECOP II', section: 'hacer', entity: 'E',
    title: 'Servicio de vigilancia', description: '', value: 2_500_000_000,
    deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación',
    score: 190, reasons: [], risks: [],
    ...o,
  };
}

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const { dbTenderToPublic } = await import(path);

  const withoutRaw = dbTenderToPublic(baseRow());
  assert.deepEqual(withoutRaw.known_phases, [], `${path}: sin raw, known_phases debe caer a lista vacía`);
  assert.equal(withoutRaw.identity_review_required, false, `${path}: sin raw, identity_review_required debe caer a falso`);
  assert.equal('raw' in withoutRaw, false, `${path}: dbTenderToPublic nunca debe exponer el campo raw`);

  const withKnownPhases = dbTenderToPublic(baseRow({
    raw: { phase_continuity: { known_phases: ['Presentación de observaciones', 'Presentación de oferta'] } },
  }));
  assert.deepEqual(
    withKnownPhases.known_phases,
    ['Presentación de observaciones', 'Presentación de oferta'],
    `${path}: debe proyectar las fases conocidas persistidas en raw.phase_continuity`,
  );
  assert.equal('raw' in withKnownPhases, false, `${path}: known_phases no debe filtrar el resto de raw`);

  const withIdentityReview = dbTenderToPublic(baseRow({ raw: { phase_identity_review: true } }));
  assert.equal(withIdentityReview.identity_review_required, true, `${path}: debe proyectar la señal de identidad por validar`);
  assert.equal('raw' in withIdentityReview, false, `${path}: identity_review_required no debe filtrar el resto de raw`);

  const withUnrelatedRaw = dbTenderToPublic(baseRow({ raw: { numero_de_proceso: 'LP-001-2026', some_provider_field: 'secret-ish' } }));
  assert.deepEqual(withUnrelatedRaw.known_phases, [], `${path}: un raw de proveedor sin phase_continuity no debe inventar fases`);
  assert.equal(withUnrelatedRaw.identity_review_required, false, `${path}: un raw de proveedor sin la señal no debe marcar revisión`);
  assert.equal('raw' in withUnrelatedRaw, false, `${path}: el payload crudo del proveedor jamás debe llegar al cliente`);
}

console.log('tender radar phase continuity projection passed');
