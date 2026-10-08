// AGT-002 — el cambio de fase de SECOP II (borrador → pliego definitivo, enlace nuevo) actualiza la
// oportunidad convertida aunque la fase nueva ya haya cerrado o haya llegado antes de la conversión.
// Casos reales del 8-oct-2026: Procuraduría LP-004-2026, Cali 4135.010.32.1.250-2026 y Rama Judicial
// Bogotá DSAJBO-SAMC-006-2026 seguían con el enlace del borrador semanas después.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { planRadarPhaseIdentitySync, tenderProcessBaseReference } from '../tender-phase-identity.js';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
process.env.VERCEL = '1';
const servers = [await import('../server/index.js'), await import('../api/[...path].js')];

const url = id => `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.${id}`;
const converted = (overrides) => ({
  stable_key: 'converted', source: 'SECOP II', title: 'Vigilancia', internal_status: 'convertida_oportunidad',
  converted_opportunity_id: 'opp-1', status: 'Presentación de observaciones', ...overrides,
});
const fetched = (overrides) => ({ source: 'SECOP II', title: 'Vigilancia', ...overrides });

test('la referencia base quita uno o varios sufijos de fase, también anidados', () => {
  assert.equal(tenderProcessBaseReference('LP-004-2026 (Presentación de oferta)'), 'LP-004-2026');
  assert.equal(tenderProcessBaseReference('4135.010.32.1.250-2026     (Presentación de oferta)'), '4135.010.32.1.250-2026');
  assert.equal(tenderProcessBaseReference('DSAJBO-SAMC-006-2026 (Manifestación de interés (Menor Cuantía)) (Presentación de oferta)'), 'DSAJBO-SAMC-006-2026');
  assert.equal(tenderProcessBaseReference('CAS-FDS-LP-001-2026 (Fase de Selección (Presentación de ofertas))'), 'CAS-FDS-LP-001-2026');
  assert.equal(tenderProcessBaseReference('FTIC-LP-003-2026'), 'FTIC-LP-003-2026');
  assert.equal(tenderProcessBaseReference('LP-001-2026 (Lote 2)'), 'LP-001-2026 (Lote 2)', 'un paréntesis que no es fase no se quita');
});

test('Procuraduría: la fase de oferta ya cerrada actualiza el enlace de la convertida', () => {
  const entity = 'PROCURADURIA GENERAL DE LA NACION';
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity, ref: 'LP-004-2026', url: url('10729711') })],
    fetched: [
      fetched({ stable_key: 'draft', entity, ref: 'LP-004-2026', url: url('10729711'), status: 'Presentación de observaciones' }),
      fetched({ stable_key: 'offer', entity, ref: 'LP-004-2026 (Presentación de oferta)', url: url('10860499'), status: 'Presentación de oferta', deadline: '2026-09-18T00:00:00.000Z' }),
    ],
  });
  assert.equal(plan.convertedOverrides[0].url, url('10860499'));
  assert.equal(plan.opportunityPatches[0].officialUrl, url('10860499'));
  assert.equal(plan.opportunityPatches[0].historicalUrl, url('10729711'));
  assert.ok(plan.omitStableKeys.includes('offer'), 'la fase de oferta no aparece como licitación aparte');
});

test('Cali: la fase de oferta ya adjudicada sigue siendo la fase de oferta', () => {
  const entity = 'SANTIAGO DE CALI DISTRITO ESPECIAL - DEPARTAMENTO ADMINISTRATIVO DE CONTRATACION PUBLICA';
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity, ref: '4135.010.32.1.250-2026', url: url('10790892') })],
    fetched: [fetched({ stable_key: 'offer', entity, ref: '4135.010.32.1.250-2026     (Presentación de oferta)', url: url('10894581'), status: 'Adjudicado' })],
  });
  assert.equal(plan.convertedOverrides[0].url, url('10894581'));
  assert.equal(plan.opportunityPatches[0].phaseChange.newPhase, 'Adjudicado');
});

test('Rama Judicial Bogotá: sufijos anidados de menor cuantía', () => {
  const entity = 'Rama Judicial- Dirección Seccional de Administración Judicial de Bogotá';
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity, ref: 'DSAJBO-SAMC-006-2026', url: url('10669958') })],
    fetched: [
      fetched({ stable_key: 'interest', entity, ref: 'DSAJBO-SAMC-006-2026 (Manifestación de interés (Menor Cuantía))', url: url('10737529'), status: 'Manifestación de interés (Menor Cuantía)' }),
      fetched({ stable_key: 'offer', entity, ref: 'DSAJBO-SAMC-006-2026 (Manifestación de interés (Menor Cuantía)) (Presentación de oferta)', url: url('10753216'), status: 'Adjudicado' }),
    ],
  });
  assert.equal(plan.convertedOverrides[0].url, url('10753216'));
  assert.deepEqual(plan.identityReviewStableKeys, []);
});

test('DANE: una convertida que ya está en la fase de oferta nunca vuelve al borrador cuando se adjudica', () => {
  const entity = 'DEPARTAMENTO ADMINISTRATIVO NACIONAL DE ESTADISTICA (DANE)';
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity, ref: 'LP-001-2026', url: url('10934125'), status: 'Adjudicado' })],
    fetched: [
      fetched({ stable_key: 'draft', entity, ref: 'LP-001-2026', url: url('10774832'), status: 'Presentación de observaciones' }),
      fetched({ stable_key: 'offer', entity, ref: 'LP-001-2026 (Presentación de oferta)', url: url('10934125'), status: 'Adjudicado' }),
    ],
  });
  assert.equal(plan.convertedOverrides[0].url, url('10934125'));
  assert.deepEqual(plan.opportunityPatches, []);
});

test('Fondo Único: cuando SECOP publique el pliego definitivo, la convertida pasa al enlace nuevo', () => {
  const entity = 'FONDO UNICO DE TECNOLOGÍAS DE LA INFORMACIÓN Y LAS COMUNICACIONES';
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity, ref: 'FTIC-LP-003-2026', url: url('10911657') })],
    fetched: [
      fetched({ stable_key: 'draft', entity, ref: 'FTIC-LP-003-2026', url: url('10911657'), status: 'Presentación de observaciones' }),
      fetched({ stable_key: 'offer', entity, ref: 'FTIC-LP-003-2026 (Presentación de oferta)', url: url('11032172'), status: 'Presentación de oferta', deadline: '2026-10-20T00:00:00.000Z' }),
    ],
  });
  assert.equal(plan.opportunityPatches[0].officialUrl, url('11032172'));
  assert.equal(plan.opportunityPatches[0].phaseChange.newPhase, 'Presentación de oferta');
});

test('Rama Judicial Barranquilla: la entidad con un carácter invisible en SECOP es la misma del CRM', () => {
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity: 'Rama Judicial  Dirección Seccional de Administración Judicial de Barranquilla', ref: 'LP-001-2026', url: url('10998214') })],
    fetched: [fetched({ stable_key: 'offer', entity: 'Rama Judicial \u0096 Dirección Seccional de Administración Judicial de Barranquilla', ref: 'LP-001-2026 (Presentación de oferta)', url: url('2'), status: 'Presentación de oferta' })],
  });
  assert.equal(plan.opportunityPatches[0]?.officialUrl, url('2'));
});

test('otra referencia de la misma entidad no se une', () => {
  const entity = 'FONDO UNICO DE TECNOLOGÍAS DE LA INFORMACIÓN Y LAS COMUNICACIONES';
  const plan = planRadarPhaseIdentitySync({
    existing: [converted({ entity, ref: 'FTIC-LP-003-2026', url: url('10911657') })],
    fetched: [fetched({ stable_key: 'other', entity, ref: 'FTIC-LP-003-2026-B (Presentación de oferta)', url: url('1'), status: 'Presentación de oferta' })],
  });
  assert.deepEqual(plan.opportunityPatches, []);
});

for (const [index, server] of servers.entries()) {
  test(`consulta por familia a datos.gov.co (${index ? 'api' : 'server'})`, async () => {
    const calls = [];
    const fetchPage = async (source, cfg, where, offset, limit) => {
      calls.push({ source, where, offset, limit });
      if (where.includes('HIGGINS')) throw new Error('SECOP II respondió 503');
      return [{
        entidad: 'PROCURADURIA GENERAL DE LA NACION', referencia_del_proceso: 'LP-004-2026 (Presentación de oferta)',
        id_del_proceso: 'CO1.REQ.2', fase: 'Presentación de oferta', estado_del_procedimiento: 'Publicado',
        fecha_de_recepcion_de: '2026-09-18T00:00:00.000', nombre_del_procedimiento: 'Vigilancia', urlproceso: { url: url('10860499') },
      }];
    };
    const now = Date.parse('2026-10-08T12:00:00Z');
    const rows = await server.fetchConvertedTenderFamilies([
      { source: 'SECOP II', entity: 'PROCURADURIA GENERAL DE LA NACION', ref: 'LP-004-2026', deadline_at: '2026-09-18T00:00:00Z' },
      { source: 'SECOP II', entity: 'PROCURADURIA GENERAL DE LA NACION', ref: 'LP-004-2026 (Presentación de oferta)', deadline_at: '2026-09-18T00:00:00Z' },
      { source: 'SECOP II', entity: "ALCALDIA O'HIGGINS", ref: 'LP-9-2026', deadline_at: null },
      { source: 'SECOP II', entity: 'VIEJA', ref: 'LP-1-2025', deadline_at: '2026-01-01T00:00:00Z' },
      { source: 'SECOP I', entity: 'X', ref: 'LP-2-2026' },
    ], { fetchPage, now });
    assert.equal(calls.length, 2, 'una consulta por familia; ni procesos de hace más de 120 días ni SECOP I');
    assert.equal(calls[0].where, "entidad like '%PROCURADURIA%GENERAL%DE%LA%NACION%' AND referencia_del_proceso like 'LP-004-2026%'");
    assert.equal(calls[1].where, "entidad like '%ALCALDIA%O%HIGGINS%' AND referencia_del_proceso like 'LP-9-2026%'", 'sin comillas sueltas en la consulta');
    assert.equal(rows.length, 1, 'una consulta fallida se omite sin cortar la importación');
    assert.equal(rows[0].url, url('10860499'));
    assert.equal(rows[0].ref, 'LP-004-2026 (Presentación de oferta)');
    assert.ok(rows[0].stable_key);
  });
}
