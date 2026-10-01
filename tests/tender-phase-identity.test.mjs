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
  now: '2026-09-28T00:00:00.000Z',
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
assert.deepEqual(opportunityPatch.phaseChange, {
  previousPhase: 'Presentación de observaciones',
  newPhase: 'Presentación de oferta',
  detectedAt: '2026-09-28T00:00:00.000Z',
}, 'the patch must carry the previous/new phase and detection time for an idempotent history note');

const convertedOverrideKnownPhases = daneLikePlan.convertedOverrides.find(row => row.stable_key === 'converted-historical-key');
assert.deepEqual(
  convertedOverrideKnownPhases.known_phases,
  ['Presentación de observaciones', 'Presentación de oferta'],
  'the Radar card needs the known phase labels, ranked from earliest to latest, to show continuity across successor SECOP phases',
);

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
assert.deepEqual(untouched.identityReviewStableKeys, []);
assert.deepEqual(daneLikePlan.identityReviewStableKeys, [], 'a clean single-successor match must never be routed to identity review');

// --- Ambiguity guard: two successor candidates tied on phase rank and deadline must not auto-merge.
function tiedSuccessorA() {
  return {
    stable_key: 'tied-successor-a',
    source: 'SECOP II',
    entity: 'Departamento Administrativo Nacional de Estadistica',
    ref: 'LP-002-2026',
    process_id: 'CO1.REQ.TIED.A',
    title: 'Servicio de vigilancia',
    url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.TIED.A',
    status: 'Presentación de oferta',
    deadline: '2026-11-01T15:00:00.000Z',
    section: 'hacer',
    score: 190,
  };
}
function tiedSuccessorB() {
  return {
    stable_key: 'tied-successor-b',
    source: 'SECOP II',
    entity: 'Departamento Administrativo Nacional de Estadistica',
    ref: 'LP-002-2026',
    process_id: 'CO1.REQ.TIED.B',
    title: 'Servicio de vigilancia',
    url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.TIED.B',
    status: 'Presentación de oferta',
    deadline: '2026-11-01T15:00:00.000Z',
    section: 'hacer',
    score: 185,
  };
}
function tiedConvertedHistorical() {
  return {
    stable_key: 'tied-converted-historical-key',
    source: 'SECOP II',
    entity: 'Departamento Administrativo Nacional de Estadistica',
    ref: 'LP-002-2026',
    process_id: 'CO1.REQ.TIED.HISTORICAL',
    title: 'Servicio de vigilancia',
    url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.TIED.HISTORICAL',
    status: 'Presentación de observaciones',
    deadline_at: '2026-09-25T15:00:00.000Z',
    internal_status: 'convertida_oportunidad',
    converted_opportunity_id: 'opp-converted-tied',
  };
}

const ambiguousPlan = planRadarPhaseIdentitySync({
  fetched: [tiedSuccessorA(), tiedSuccessorB()],
  existing: [tiedConvertedHistorical()],
  now: '2026-09-28T00:00:00.000Z',
});
assert.deepEqual(
  [...ambiguousPlan.identityReviewStableKeys].sort(),
  ['tied-successor-a', 'tied-successor-b'],
  'tied successor candidates (same phase rank, same deadline) must be routed to identity review instead of being auto-merged',
);
assert.equal(ambiguousPlan.omitStableKeys.includes('tied-successor-a'), false, 'a tied candidate must not be silently omitted as a duplicate');
assert.equal(ambiguousPlan.omitStableKeys.includes('tied-successor-b'), false, 'a tied candidate must not be silently omitted as a duplicate');
assert.equal(ambiguousPlan.discardStableKeys.length, 0, 'ambiguous ties must fail closed: no discard without a confident identity');
assert.deepEqual(ambiguousPlan.convertedOverrides, [], 'the converted opportunity identity must not change while the successor identity is ambiguous');
assert.deepEqual(ambiguousPlan.opportunityPatches, [], 'no opportunity-history note is written while the identity is ambiguous');

// A second run with the exact same inputs must reach the exact same conclusion (idempotent).
const ambiguousPlanAgain = planRadarPhaseIdentitySync({
  fetched: [tiedSuccessorA(), tiedSuccessorB()],
  existing: [tiedConvertedHistorical()],
  now: '2026-09-29T00:00:00.000Z',
});
assert.deepEqual([...ambiguousPlanAgain.identityReviewStableKeys].sort(), ['tied-successor-a', 'tied-successor-b']);

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

// --- Opportunity-history note: previous phase, new phase and detected time, idempotent, with URLs preserved.
const phaseChange = { previousPhase: 'Presentación de observaciones', newPhase: 'Presentación de oferta', detectedAt: '2026-09-28T00:00:00.000Z' };
const notesWithPhaseHistory = applyOfficialSourceLink(notes, { officialUrl: OFFICIAL_URL, historicalUrl: HISTORICAL_URL, phaseChange });
assert.equal(notesWithPhaseHistory.includes(`Link fuente: ${OFFICIAL_URL}`), true, 'the official URL must still be present');
assert.equal(notesWithPhaseHistory.includes(`Link fuente histórico: ${HISTORICAL_URL}`), true, 'the historical URL must still be preserved');
assert.match(
  notesWithPhaseHistory,
  /Fase detectada: Presentación de observaciones → Presentación de oferta \(2026-09-28T00:00:00\.000Z\)/,
  'the note must record the previous phase, the new phase and the detection time',
);
const notesWithPhaseHistoryTwice = applyOfficialSourceLink(notesWithPhaseHistory, { officialUrl: OFFICIAL_URL, historicalUrl: HISTORICAL_URL, phaseChange });
assert.equal(notesWithPhaseHistoryTwice, notesWithPhaseHistory, 'appending the same detected transition twice must be idempotent, not duplicated');
assert.equal(
  (notesWithPhaseHistoryTwice.match(/Fase detectada:/g) || []).length,
  1,
  'the same previous/new phase transition must only be recorded once',
);
// A later, different transition on the same opportunity is a new real event and must be appended, not replace history.
const secondPhaseChange = { previousPhase: 'Presentación de oferta', newPhase: 'Adjudicación', detectedAt: '2026-10-05T00:00:00.000Z' };
const notesWithSecondTransition = applyOfficialSourceLink(notesWithPhaseHistory, { officialUrl: OFFICIAL_URL, historicalUrl: HISTORICAL_URL, phaseChange: secondPhaseChange });
assert.match(notesWithSecondTransition, /Fase detectada: Presentación de observaciones → Presentación de oferta/, 'the first transition must stay in history');
assert.match(notesWithSecondTransition, /Fase detectada: Presentación de oferta → Adjudicación \(2026-10-05T00:00:00\.000Z\)/, 'a new transition must be appended as a new line');
// No transition (previousPhase === newPhase) must never append a note.
assert.equal(
  applyOfficialSourceLink(notes, { officialUrl: OFFICIAL_URL, historicalUrl: HISTORICAL_URL, phaseChange: { previousPhase: 'Presentación de oferta', newPhase: 'Presentación de oferta', detectedAt: '2026-09-28T00:00:00.000Z' } }),
  applyOfficialSourceLink(notes, { officialUrl: OFFICIAL_URL, historicalUrl: HISTORICAL_URL }),
  'identical previous/new phase must not be treated as a transition',
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
  assert.match(source, /identityReviewStableKeys/, `${path} must route ambiguous successor identities to review instead of auto-merging`);
  assert.match(source, /known_phases/, `${path} must persist known successor phases for the Radar card`);
  assert.match(source, /phase_identity_review/, `${path} must flag ambiguous rows so the UI can show "Identidad por validar" outside normal conversion`);
  const dbTenderToPublicBody = source.match(/export function dbTenderToPublic\(row, options\) \{[\s\S]*?\n\}\n/);
  assert.ok(dbTenderToPublicBody, `${path} must define dbTenderToPublic`);
  assert.doesNotMatch(dbTenderToPublicBody[0], /\braw\s*:\s*row\.raw\b/, `${path} dbTenderToPublic must never leak the raw provider payload itself to the client`);
}

console.log('tender phase identity passed');
