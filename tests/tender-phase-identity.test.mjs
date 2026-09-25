import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  applyOfficialSourceLink,
  planRadarPhaseIdentitySync,
} from '../tender-phase-identity.js';

const HISTORICAL_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.HISTORICAL';
const OFFICIAL_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.OFFICIAL';
const OTHER_ENTITY_URL = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.OTHER';

function convertedHistorical() {
  return {
    stable_key: 'converted-historical-key',
    source: 'SECOP II',
    entity: 'Departamento Administrativo Nacional de Estadistica',
    ref: 'LP-001-2026',
    process_id: 'CO1.REQ.HISTORICAL',
    title: 'Servicio de vigilancia',
    url: HISTORICAL_URL,
    status: 'Presentación de observaciones',
    deadline_at: '2026-09-25T15:00:00.000Z',
    internal_status: 'convertida_oportunidad',
    converted_opportunity_id: 'opp-converted-1',
  };
}

function fetchedHistorical() {
  return {
    stable_key: 'converted-historical-key',
    source: 'SECOP II',
    entity: 'Departamento Administrativo Nacional de Estadistica',
    ref: 'LP-001-2026',
    process_id: 'CO1.REQ.HISTORICAL',
    title: 'Servicio de vigilancia',
    url: HISTORICAL_URL,
    status: 'Presentación de observaciones',
    deadline: '2026-09-25T15:00:00.000Z',
    section: 'hacer',
    score: 190,
  };
}

function fetchedOfficial() {
  return {
    stable_key: 'successor-offer-key',
    source: 'SECOP II',
    entity: 'Departamento Administrativo Nacional de Estadistica',
    ref: 'LP-001-2026',
    process_id: 'CO1.REQ.OFFICIAL',
    title: 'Servicio de vigilancia',
    url: OFFICIAL_URL,
    status: 'Presentación de oferta',
    deadline: '2026-10-02T15:00:00.000Z',
    section: 'hacer',
    score: 195,
  };
}

function otherEntitySameRef() {
  return {
    stable_key: 'other-entity-key',
    source: 'SECOP II',
    entity: 'Corporacion Autonoma Regional',
    ref: 'LP-001-2026',
    process_id: 'CO1.REQ.OTHER',
    title: 'Otra vigilancia',
    url: OTHER_ENTITY_URL,
    status: 'Presentación de oferta',
    deadline: '2026-11-01T15:00:00.000Z',
    section: 'revisar',
    score: 80,
  };
}

const daneLikePlan = planRadarPhaseIdentitySync({
  fetched: [fetchedHistorical(), fetchedOfficial(), otherEntitySameRef()],
  existing: [convertedHistorical(), {
    ...fetchedOfficial(),
    deadline_at: fetchedOfficial().deadline,
    internal_status: 'nueva',
    converted_opportunity_id: null,
  }],
});

assert.equal(daneLikePlan.omitStableKeys.includes('successor-offer-key'), true, 'successor phase must not persist as a new convertible radar row');
assert.equal(daneLikePlan.omitStableKeys.includes('other-entity-key'), false, 'same LP on a different entity is a different process');
assert.equal(daneLikePlan.discardStableKeys.includes('successor-offer-key'), true, 'already-persisted successor must be discarded, not converted');
assert.equal(daneLikePlan.discardStableKeys.includes('converted-historical-key'), false, 'converted row must stay converted');

const convertedOverride = daneLikePlan.convertedOverrides.find(row => row.stable_key === 'converted-historical-key');
assert.ok(convertedOverride, 'converted radar row must keep its stable_key');
assert.equal(convertedOverride.url, OFFICIAL_URL);
assert.equal(convertedOverride.process_id, 'CO1.REQ.OFFICIAL');
assert.equal(convertedOverride.status, 'Presentación de oferta');
assert.equal(convertedOverride.deadline_at, '2026-10-02T15:00:00.000Z');

const opportunityPatch = daneLikePlan.opportunityPatches.find(row => row.converted_opportunity_id === 'opp-converted-1');
assert.ok(opportunityPatch, 'converted opportunity must receive the official SECOP identity');
assert.equal(opportunityPatch.officialUrl, OFFICIAL_URL);
assert.equal(opportunityPatch.historicalUrl, HISTORICAL_URL);
assert.equal(opportunityPatch.processId, 'CO1.REQ.OFFICIAL');
assert.equal(opportunityPatch.deadline, '2026-10-02T15:00:00.000Z');

const alreadyOfficial = planRadarPhaseIdentitySync({
  fetched: [fetchedHistorical(), fetchedOfficial()],
  existing: [{
    ...convertedHistorical(),
    url: OFFICIAL_URL,
    process_id: 'CO1.REQ.OFFICIAL',
    status: 'Presentación de oferta',
    deadline_at: '2026-10-02T15:00:00.000Z',
  }],
});
assert.equal(alreadyOfficial.convertedOverrides[0].url, OFFICIAL_URL, 'persist must not revert a converted row to the historical notice');
assert.equal(alreadyOfficial.convertedOverrides[0].process_id, 'CO1.REQ.OFFICIAL');

const untouched = planRadarPhaseIdentitySync({
  fetched: [otherEntitySameRef()],
  existing: [convertedHistorical()],
});
assert.deepEqual(untouched.convertedOverrides, []);
assert.deepEqual(untouched.omitStableKeys, []);
assert.deepEqual(untouched.opportunityPatches, []);

const notes = [
  'Origen: SECOP II / Radar Licitaciones',
  'Referencia: LP-001-2026',
  `Link fuente: ${HISTORICAL_URL}`,
].join('\n');
const updatedNotes = applyOfficialSourceLink(notes, {
  officialUrl: OFFICIAL_URL,
  historicalUrl: HISTORICAL_URL,
});
assert.equal(updatedNotes.includes(`Link fuente: ${OFFICIAL_URL}`), true);
assert.equal(updatedNotes.includes(`Link fuente histórico: ${HISTORICAL_URL}`), true);
assert.equal(
  applyOfficialSourceLink(updatedNotes, { officialUrl: OFFICIAL_URL, historicalUrl: HISTORICAL_URL }),
  updatedNotes,
  'opportunity notes update must be idempotent',
);

const backendPaths = ['../server/index.js', '../api/[...path].js'];
for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /from '\.\.\/tender-phase-identity\.js'/, `${path} must import the phase-identity planner`);
  assert.match(source, /planRadarPhaseIdentitySync\(/, `${path} persistTenderRadar must apply the phase-identity planner`);
  assert.match(source, /applyOfficialSourceLink\(/, `${path} must rewrite the converted opportunity source link`);
  assert.match(
    source,
    /stable_key:\s*t\.stable_key\s*\|\|\s*stableTenderKey\(t\)/,
    `${path} must keep the converted stable_key instead of rehashing a successor process_id`,
  );
}

console.log('tender phase identity passed');
