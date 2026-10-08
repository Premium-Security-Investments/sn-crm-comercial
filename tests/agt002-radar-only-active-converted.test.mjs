// AGT-002 — decisión del dueño (8-oct-2026): el Radar diario no toca oportunidades que no están ACTIVAS
// (Por decidir / En curso): ni enlace, ni proceso, ni observaciones. Sus versiones nuevas siguen omitidas del Radar.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { planRadarPhaseIdentitySync } from '../tender-phase-identity.js';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
process.env.VERCEL = '1';
const servers = [await import('../server/index.js'), await import('../api/[...path].js')];

const url = id => `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.${id}`;
const converted = (key, opp, entity, ref, id) => ({ id: `t-${key}`, stable_key: key, source: 'SECOP II', entity, ref, url: url(id), status: 'Presentación de observaciones', internal_status: 'convertida_oportunidad', converted_opportunity_id: opp });
const offer = (key, entity, ref, id) => ({ stable_key: key, source: 'SECOP II', entity, ref: `${ref} (Presentación de oferta)`, url: url(id), status: 'Presentación de oferta', deadline: '2026-11-20T00:00:00.000Z' });

const existing = [
  converted('proc', 'opp-proc', 'PROCURADURIA GENERAL DE LA NACION', 'LP-004-2026', '10729711'),
  converted('ftic', 'opp-ftic', 'FONDO UNICO', 'FTIC-LP-003-2026', '10911657'),
];
const fetched = [offer('proc-offer', 'PROCURADURIA GENERAL DE LA NACION', 'LP-004-2026', '10860499'), offer('ftic-offer', 'FONDO UNICO', 'FTIC-LP-003-2026', '11032172')];
const byKey = new Map(existing.map(row => [row.stable_key, row]));

for (const [index, server] of servers.entries()) {
  const label = index ? 'api' : 'server';
  test(`${label}: una oportunidad cerrada (NO GO) no cambia de enlace ni de observaciones; la activa sí`, async () => {
    const full = planRadarPhaseIdentitySync({ fetched, existing });
    assert.equal(full.opportunityPatches.length, 2);
    const plan = await server.withoutInactiveConvertedChanges(null, full, byKey, { blocker: async (_db, id) => (id === 'opp-proc' ? 'opportunity_closed' : null) });
    assert.deepEqual(plan.convertedOverrides.map(row => row.stable_key), ['ftic']);
    assert.deepEqual(plan.opportunityPatches.map(patch => patch.converted_opportunity_id), ['opp-ftic']);
    assert.ok(plan.omitStableKeys.includes('proc-offer'), 'la versión nueva de la cerrada sigue fuera del Radar');
  });
  test(`${label}: si no se puede leer la etapa, no se toca (lado seguro)`, async () => {
    const full = planRadarPhaseIdentitySync({ fetched, existing });
    const plan = await server.withoutInactiveConvertedChanges(null, full, byKey, { blocker: async () => { throw new Error('sin red'); } });
    assert.deepEqual(plan.convertedOverrides, []);
    assert.deepEqual(plan.opportunityPatches, []);
  });
  test(`${label}: todas activas → el plan no cambia`, async () => {
    const full = planRadarPhaseIdentitySync({ fetched, existing });
    const plan = await server.withoutInactiveConvertedChanges(null, full, byKey, { blocker: async () => null });
    assert.equal(plan, full);
  });
}
