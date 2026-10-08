// AGT-002 · Familias de proceso SECOP II: un proceso modificado se republica como proceso nuevo con la misma
// referencia salvo puntuación/espacios. Fixtures: pares reales observados en psi_public_tenders (oct-2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  compareTenderFamilyRecency,
  groupTenderProcessFamilies,
  isDistinctiveTenderFamilyReference,
  isProcessFamilySupersededRow,
  normalizeTenderFamilyReference,
  planTenderProcessFamilySupersession,
  tenderProcessFamilyKey,
  withProcessFamilySupersededRaw,
} from '../tender-process-family.js';
import { applyOfficialSourceLink, planRadarPhaseIdentitySync } from '../tender-phase-identity.js';

const secop = (overrides) => ({ source: 'SECOP II', status: 'Presentación de oferta', title: 'Servicio de vigilancia', ...overrides });
const REAL_PAIRS = [
  ['SUPERINTENDENCIA DE VIGILANCIA Y SEGURIDAD PRIVADA', ['CDPS-0312-2026', 'CDPS-0312-2026.'], 'CDPS03122026'],
  ['GOBERNACION DE SUCRE', ['CP-SDSD-440-2026', 'CP-SDSD-440-2026*'], 'CPSDSD4402026'],
  ['DIEPO', ['SIP 085 2026', 'SIP 085 2026.'], 'SIP0852026'],
  ['INSTITUTO DE DEPORTES Y RECREACION DE MEDELLIN', ['6700049978', '6700049978.'], '6700049978'],
  ['SECRETARIA DE SEGURIDAD Y CONVIVENCIA', ['SCJ-SIF-CD-347- 2026', 'SCJ-SIF-CD-347-2026'], 'SCJSIFCD3472026'],
  ['ESE HOSPITAL SAN JORGE', ['323-2026', '323-2026.', '323--2026'], '3232026'],
];

test('normaliza la referencia quitando todo carácter no alfanumérico (pares reales)', () => {
  for (const [, refs, expected] of REAL_PAIRS) {
    for (const ref of refs) assert.equal(normalizeTenderFamilyReference(ref), expected, ref);
  }
  assert.equal(normalizeTenderFamilyReference('FTIC-LP-003-2026'), 'FTICLP0032026');
  assert.equal(normalizeTenderFamilyReference('LP-001 (Presentación de oferta)'), 'LP001', 'el sufijo de fase no forma parte de la referencia');
});

test('agrupa cada par real en una sola familia y elige la versión más reciente', () => {
  for (const [entity, refs, normalized] of REAL_PAIRS) {
    const rows = refs.map((ref, index) => secop({
      stable_key: `${normalized}-${index}`, entity, ref, process_id: `CO1.REQ.${1000 + index}`,
      published: `2026-09-${String(10 + index).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const families = groupTenderProcessFamilies(rows);
    assert.equal(families.length, 1, entity);
    assert.equal(families[0].members.length, refs.length, entity);
    assert.equal(families[0].current.stable_key, `${normalized}-${refs.length - 1}`, `${entity}: gana la publicada más tarde`);
  }
});

test('empate de fecha de publicación: gana el número de proceso mayor; sin fechas no se decide', () => {
  const a = secop({ stable_key: 'a', entity: 'DIEPO', ref: 'SIP 085 2026', process_id: 'CO1.REQ.11038226', published: '2026-10-07T00:00:00Z' });
  const b = secop({ stable_key: 'b', entity: 'DIEPO', ref: 'SIP 085 2026.', process_id: 'CO1.REQ.11040001', published: '2026-10-07T00:00:00Z' });
  assert.ok(compareTenderFamilyRecency(b, a) > 0);
  assert.equal(groupTenderProcessFamilies([a, b])[0].current.stable_key, 'b');
  const undated = groupTenderProcessFamilies([{ ...a, published: null }, { ...b, published: null }]);
  assert.equal(undated[0].current, null, 'sin fechas no se oculta nada');
  assert.equal(compareTenderFamilyRecency({ ...a, published: null }, b), 0);
});

test('guardas contra falsos positivos', () => {
  for (const generic of ['', 'LP-1', 'N/A', 'Sin referencia', 'LP-2026', 'CD 2026', '000000', 'Licitación pública', 'CONTRATACION DIRECTA']) {
    assert.equal(isDistinctiveTenderFamilyReference(normalizeTenderFamilyReference(generic)), false, generic);
    assert.equal(tenderProcessFamilyKey(secop({ entity: 'DIEPO', ref: generic })), null, generic);
  }
  // Misma referencia en otra entidad, u otra fuente: nunca es la misma familia.
  const sucre = tenderProcessFamilyKey(secop({ entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026' }));
  assert.notEqual(sucre, tenderProcessFamilyKey(secop({ entity: 'GOBERNACION DE BOLIVAR', ref: 'CP-SDSD-440-2026' })));
  assert.equal(tenderProcessFamilyKey({ source: 'SECOP I', entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026' }), null);
  assert.equal(tenderProcessFamilyKey({ source: 'TVEC', entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026' }), null);
  // Referencias distintas de verdad no se mezclan.
  assert.notEqual(tenderProcessFamilyKey(secop({ entity: 'DIEPO', ref: 'SIP 085 2026' })), tenderProcessFamilyKey(secop({ entity: 'DIEPO', ref: 'SIP 086 2026' })));
  // La entidad se compara normalizada (tildes, puntos, espacios).
  assert.equal(tenderProcessFamilyKey(secop({ entity: 'E.S.E. Hospital  San Jorge', ref: '323-2026' })), tenderProcessFamilyKey(secop({ entity: 'ESE HOSPITAL SAN JORGE', ref: '323--2026' })));
});

test('sin convertida: las versiones anteriores quedan marcadas (no borradas) y la vigente hereda la revisión', () => {
  const entity = 'ESE HOSPITAL SAN JORGE';
  const rows = [
    secop({ stable_key: 'v1', entity, ref: '323-2026', process_id: 'CO1.REQ.1', url: 'u1', published: '2026-09-01T00:00:00Z', internal_status: 'en_revision' }),
    secop({ stable_key: 'v2', entity, ref: '323-2026.', process_id: 'CO1.REQ.2', url: 'u2', published: '2026-09-15T00:00:00Z', internal_status: 'nueva' }),
    secop({ stable_key: 'v3', entity, ref: '323--2026', process_id: 'CO1.REQ.3', url: 'u3', published: '2026-10-01T00:00:00Z', internal_status: null }),
  ];
  const plan = planTenderProcessFamilySupersession({ rows, existingStableKeys: new Set(['v1', 'v2']) });
  assert.deepEqual(plan.supersededMarks.map(mark => mark.stable_key).sort(), ['v1', 'v2']);
  assert.ok(plan.supersededMarks.every(mark => mark.superseded_by.stable_key === 'v3' && mark.superseded_by.url === 'u3'));
  assert.deepEqual(plan.inheritedStatuses, [{ stable_key: 'v3', internal_status: 'en_revision' }]);
  // Idempotente: la segunda corrida (v3 ya existe) vuelve a marcar lo mismo y no pisa estados.
  const again = planTenderProcessFamilySupersession({ rows, existingStableKeys: new Set(['v1', 'v2', 'v3']) });
  assert.deepEqual(again.supersededMarks, plan.supersededMarks);
  assert.deepEqual(again.inheritedStatuses, []);
  // Con una convertida en la familia este plan no toca nada (lo resuelve la continuidad de identidad).
  const withConverted = planTenderProcessFamilySupersession({ rows: [...rows, { ...rows[0], stable_key: 'conv', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp' }] });
  assert.deepEqual(withConverted, { supersededMarks: [], inheritedStatuses: [] });
  // La marca vive en raw y oculta sólo filas no convertidas.
  const raw = withProcessFamilySupersededRaw({ entidad: 'x' }, plan.supersededMarks[0].superseded_by);
  assert.equal(isProcessFamilySupersededRow({ raw }), true);
  assert.equal(isProcessFamilySupersededRow({ raw, internal_status: 'convertida_oportunidad' }), false);
  assert.deepEqual(withProcessFamilySupersededRaw(raw, null), { entidad: 'x' });
});

const FTIC_ENTITY = 'FONDO UNICO DE TECNOLOGIAS DE LA INFORMACION Y LAS COMUNICACIONES';
const FTIC_OLD_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10911657&isFromPublicArea=True&isModal=False';
const FTIC_NEW_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11032172&isFromPublicArea=True&isModal=False';
const fticConverted = () => ({
  stable_key: 'ftic-converted', source: 'SECOP II', entity: FTIC_ENTITY, ref: 'FTIC-LP-003-2026', process_id: 'CO1.REQ.11038226',
  title: 'Servicio de vigilancia', url: FTIC_OLD_URL, status: 'Presentación de oferta', deadline_at: '2026-10-20T15:00:00.000Z',
  published_at: '2026-09-25T10:00:00.000Z', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-ftic',
});
const fticFetchedOld = () => ({ ...fticConverted(), deadline: '2026-10-20T15:00:00.000Z', published: '2026-09-25T10:00:00.000Z', internal_status: 'nueva', converted_opportunity_id: null });
const fticFetchedNew = () => ({
  stable_key: 'ftic-republished', source: 'SECOP II', entity: FTIC_ENTITY, ref: 'FTIC-LP-003-2026.', process_id: 'CO1.REQ.11160001',
  title: 'Servicio de vigilancia', url: FTIC_NEW_URL, status: 'Presentación de oferta', deadline: '2026-10-28T15:00:00.000Z',
  published: '2026-10-07T16:00:00.000Z', internal_status: 'nueva', converted_opportunity_id: null,
});

test('FTIC: la versión republicada se enlaza a la oportunidad convertida en vez de aparecer como nueva', () => {
  const plan = planRadarPhaseIdentitySync({ fetched: [fticFetchedOld(), fticFetchedNew()], existing: [fticConverted()], now: '2026-10-08T11:00:00.000Z' });
  assert.deepEqual(plan.omitStableKeys, ['ftic-republished'], 'la versión nueva no se persiste como licitación nueva para convertir');
  assert.deepEqual(plan.identityReviewStableKeys, []);
  const override = plan.convertedOverrides.find(row => row.stable_key === 'ftic-converted');
  assert.equal(override.url, FTIC_NEW_URL, 'la licitación convertida pasa a la URL del aviso nuevo (fuente de "importar documentos oficiales")');
  assert.equal(override.process_id, 'CO1.REQ.11160001');
  const patch = plan.opportunityPatches[0];
  assert.equal(patch.converted_opportunity_id, 'opp-ftic');
  assert.deepEqual(patch.republication, { ref: 'FTIC-LP-003-2026.', url: FTIC_NEW_URL, processId: 'CO1.REQ.11160001', detectedAt: '2026-10-08T11:00:00.000Z' });

  const notes = applyOfficialSourceLink(`Origen: SECOP II / Radar Licitaciones\nLink fuente: ${FTIC_OLD_URL}`, patch);
  assert.match(notes, new RegExp(`^Link fuente: ${FTIC_NEW_URL.replace(/[.?&]/g, '\\$&')}$`, 'm'));
  assert.ok(notes.includes(`Link fuente histórico: ${FTIC_OLD_URL}`), 'el aviso anterior queda como historial');
  assert.ok(notes.includes(`SECOP publicó una versión nueva del proceso (FTIC-LP-003-2026.): ${FTIC_NEW_URL}`));
  assert.equal(applyOfficialSourceLink(notes, patch), notes, 'el aviso no se duplica en corridas diarias');

  // Corrida siguiente (la convertida ya apunta al aviso nuevo): sin parche nuevo, sin duplicar, sin volver atrás.
  const persisted = { ...fticConverted(), url: override.url, process_id: override.process_id, deadline_at: override.deadline_at };
  const next = planRadarPhaseIdentitySync({ fetched: [fticFetchedOld(), fticFetchedNew()], existing: [persisted, { ...fticFetchedNew(), internal_status: 'nueva' }], now: '2026-10-09T11:00:00.000Z' });
  assert.deepEqual(next.opportunityPatches, []);
  assert.equal(next.convertedOverrides[0].url, FTIC_NEW_URL);
  assert.deepEqual(next.omitStableKeys, ['ftic-republished']);
  assert.deepEqual(next.discardStableKeys, ['ftic-republished'], 'una fila "nueva" persistida antes del arreglo queda descartada, no convertible');
});

test('FTIC: referencias con asterisco o espacios también enlazan (antes sólo el punto final)', () => {
  const plan = planRadarPhaseIdentitySync({
    fetched: [{ ...fticFetchedNew(), ref: 'FTIC-LP-003- 2026*' }],
    existing: [fticConverted()],
    now: '2026-10-08T11:00:00.000Z',
  });
  assert.equal(plan.convertedOverrides[0]?.url, FTIC_NEW_URL);
  const other = planRadarPhaseIdentitySync({ fetched: [{ ...fticFetchedNew(), ref: 'FTIC-LP-004-2026' }], existing: [fticConverted()] });
  assert.deepEqual(other.convertedOverrides, [], 'otra referencia de la misma entidad no se enlaza');
});

test('backend: importación, lectura y jobs del host usan la familia de proceso', () => {
  for (const path of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /from '\.\.\/tender-process-family\.js'/, path);
    assert.match(source, /planTenderProcessFamilySupersession\(/, `${path}: persistTenderRadar marca versiones reemplazadas`);
    assert.match(source, /!isProcessFamilySupersededRow\(row\)/, `${path}: el Radar no lista versiones reemplazadas`);
    assert.match(source, /republication: patch\.republication/, `${path}: el aviso llega a la oportunidad`);
    assert.match(source, /export async function importRepublishedTenderDocuments\(/, `${path}: importación documental del aviso nuevo`);
    assert.match(source, /psi_retire_tender_document_versions/, `${path}: los documentos anteriores quedan como historial`);
  }
  for (const path of ['../tender-process-family.js', '../agt002-republication-followup.js']) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), 'utf8'), /agt003/i, `${path} respeta el límite AGT-002`);
  }
  const radarRunner = readFileSync(new URL('../ops/agt002-radar-daily/run-agt002-radar-import.mjs', import.meta.url), 'utf8');
  assert.match(radarRunner, /runAgt002RepublicationDocumentRefresh/);
  const autoInitialRunner = readFileSync(new URL('../ops/agt002-auto-initial/run-agt002-auto-initial.mjs', import.meta.url), 'utf8');
  assert.match(autoInitialRunner, /runAgt002RepublicationAnalysisAdmissions/);
  assert.ok(existsSync(new URL('../supabase/migrations/116_agt002_retire_republished_tender_documents.sql', import.meta.url)));
  assert.ok(existsSync(new URL('../supabase/rollbacks/116_agt002_retire_republished_tender_documents_rollback.sql', import.meta.url)));
});
