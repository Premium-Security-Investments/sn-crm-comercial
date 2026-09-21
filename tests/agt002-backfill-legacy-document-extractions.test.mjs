import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  buildBackfillPlan,
  executeBackfill,
  parseArgs,
  summarizePlan,
} from '../scripts/agt002-backfill-legacy-document-extractions.mjs';

const opportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOpportunityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tenderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const versionOkId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const versionPendingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// Contiene tildes/eñes a propósito: char_count (UTF-16) y byte_count (UTF-8)
// deben divergir para que la prueba distinga un cómputo correcto de uno que
// solo copia un valor al otro.
const legacyText = 'Texto legado con acentós y eñes: memoria histórica completa.';
const legacyTextHash = createHash('sha256').update(legacyText, 'utf8').digest('hex');
assert.notEqual(legacyText.length, Buffer.byteLength(legacyText, 'utf8'), 'el texto de prueba debe tener char_count y byte_count distintos');

const activeHumanProfile = { id: actorId, identity_type: 'human', active: true };
const versionRows = [
  { id: versionOkId, opportunity_id: opportunityId, tender_id: tenderId, current: true, extracted_text: 'texto ya migrado' },
  { id: versionPendingId, opportunity_id: opportunityId, tender_id: tenderId, current: true, extracted_text: legacyText },
];
const existingOkExtraction = {
  document_version_id: versionOkId, extractor_version: 'tender-document-text-extraction@2', status: 'ok',
};

function makeClient({ profile = activeHumanProfile, versions = versionRows, extractions = [], getError, rpcError } = {}) {
  const getCalls = [];
  const rpcCalls = [];
  return {
    getCalls,
    rpcCalls,
    extractions,
    async get(path) {
      getCalls.push(path);
      if (getError && path.startsWith(getError.prefix)) throw getError.error;
      if (path.startsWith('psi_sales_profiles?')) return profile ? [profile] : [];
      if (path.startsWith('psi_tender_document_versions?')) return versions;
      if (path.startsWith('psi_tender_document_extractions?')) return extractions;
      throw new Error(`GET inesperado: ${path}`);
    },
    async rpc(name, payload) {
      rpcCalls.push({ name, payload });
      if (rpcError) throw rpcError;
      assert.equal(name, 'psi_backfill_legacy_tender_document_extraction', 'el único RPC de escritura permitido');
      // El RPC atómico fija extractor_version/status del lado del servidor: el fake los
      // reproduce en vez de leerlos del payload, que ya no los transporta.
      extractions.push({
        document_version_id: payload.p_document_version_id,
        extractor_version: 'legacy-version-register@1',
        status: 'ok',
        text_hash: payload.p_text_hash,
      });
      return { status: 'created' };
    },
  };
}

// --- parseArgs -------------------------------------------------------------

assert.throws(
  () => parseArgs(['--actor-id', actorId, '--expected-count', '2']),
  /opportunity-id/i,
  'debe exigir --opportunity-id',
);
assert.throws(
  () => parseArgs(['--opportunity-id', opportunityId, '--expected-count', '2']),
  /actor-id/i,
  'debe exigir --actor-id',
);
assert.throws(
  () => parseArgs(['--opportunity-id', opportunityId, '--actor-id', actorId]),
  /expected-count/i,
  'debe exigir --expected-count',
);
assert.throws(
  () => parseArgs(['--opportunity-id', 'no-es-un-uuid', '--actor-id', actorId, '--expected-count', '2']),
  /opportunity-id/i,
  '--opportunity-id debe ser un UUID válido',
);
assert.throws(
  () => parseArgs(['--opportunity-id', opportunityId, '--actor-id', 'no-es-un-uuid', '--expected-count', '2']),
  /actor-id/i,
  '--actor-id debe ser un UUID válido',
);
assert.throws(
  () => parseArgs(['--opportunity-id', opportunityId, '--actor-id', actorId, '--expected-count', '0']),
  /expected-count/i,
  '--expected-count debe ser un entero positivo',
);
assert.throws(
  () => parseArgs(['--opportunity-id', opportunityId, '--actor-id', actorId, '--expected-count', 'dos']),
  /expected-count/i,
  '--expected-count debe ser numérico',
);

const baseArgv = ['--opportunity-id', opportunityId, '--actor-id', actorId, '--expected-count', '2'];
const dryRunOptions = parseArgs(baseArgv);
assert.equal(dryRunOptions.commit, false, 'dry-run debe ser el modo por defecto');
assert.equal(dryRunOptions.opportunityId, opportunityId);
assert.equal(dryRunOptions.actorId, actorId);
assert.equal(dryRunOptions.expectedCount, 2);

const commitOptions = parseArgs([...baseArgv, '--commit']);
assert.equal(commitOptions.commit, true, '--commit debe ser explícito');

// --- buildBackfillPlan: alcance y forma del plan ---------------------------

const client = makeClient({ extractions: [{ ...existingOkExtraction }] });
const plan = await buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client });

assert.ok(
  client.getCalls.some(path => path.startsWith('psi_tender_document_versions?')
    && /current=eq\.true/.test(path)
    && path.includes(`opportunity_id=eq.${opportunityId}`)),
  'debe consultar únicamente versiones vigentes de la oportunidad indicada',
);

assert.equal(plan.items.length, 2, 'el plan debe cubrir todas las versiones vigentes encontradas');
const skipItem = plan.items.find(item => item.documentVersionId === versionOkId);
const insertItem = plan.items.find(item => item.documentVersionId === versionPendingId);
assert.equal(skipItem.action, 'skip', 'una versión con extracción status=ok existente debe omitirse');
assert.ok(!skipItem.rpcParams, 'una versión omitida no debe transportar el texto legado');
assert.equal(insertItem.action, 'insert', 'una versión sin extracción real previa debe planearse para inserción');

// --- cómputo determinista desde el texto legado -----------------------------

assert.equal(insertItem.rpcParams.p_extracted_text, legacyText, 'debe usar el texto legado exacto, sin transformarlo');
assert.equal(insertItem.rpcParams.p_text_hash, legacyTextHash, 'el hash SHA-256 debe calcularse sobre el texto legado exacto');
assert.equal(insertItem.rpcParams.p_char_count, legacyText.length, 'char_count debe ser el largo exacto del texto legado');
assert.equal(insertItem.rpcParams.p_text_byte_count, Buffer.byteLength(legacyText, 'utf8'), 'byte_count debe ser el tamaño UTF-8 exacto del texto legado');
assert.equal(insertItem.rpcParams.p_extractor_version, 'legacy-version-register@1', 'debe declarar el extractor legado fijo');
assert.equal(insertItem.rpcParams.p_parser, 'legacy-version-column', 'debe declarar el parser legado fijo');
assert.equal(insertItem.rpcParams.p_status, 'ok');
assert.equal(insertItem.rpcParams.p_gap_reason, null, 'un registro legado nunca es un gap');
assert.equal(insertItem.rpcParams.p_opportunity_id, opportunityId);
assert.equal(insertItem.rpcParams.p_tender_id, tenderId);
assert.equal(insertItem.rpcParams.p_document_version_id, versionPendingId);
assert.equal(insertItem.rpcParams.p_actor_id, actorId);

// --- rechazos de validación --------------------------------------------------

const scopeMismatchClient = makeClient({
  versions: [{ id: versionPendingId, opportunity_id: otherOpportunityId, tender_id: tenderId, current: true, extracted_text: legacyText }],
});
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 1, client: scopeMismatchClient }),
  /oportunidad/i,
  'debe rechazar una versión cuyo opportunity_id no coincide con el alcance pedido',
);

const inactiveActorClient = makeClient({ profile: { id: actorId, identity_type: 'human', active: false } });
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: inactiveActorClient }),
  /activo/i,
  'debe rechazar un actor inactivo',
);

const nonHumanActorClient = makeClient({ profile: { id: actorId, identity_type: 'agent', active: true } });
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: nonHumanActorClient }),
  /human/i,
  'debe rechazar un actor no humano',
);

const missingActorClient = makeClient({ profile: null });
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: missingActorClient }),
  /human/i,
  'debe rechazar cuando el actor no existe',
);

await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 5, client: makeClient() }),
  /2|5/,
  'debe rechazar cuando el número de versiones vigentes no coincide con --expected-count',
);

const blankTextClient = makeClient({
  versions: [{ id: versionPendingId, opportunity_id: opportunityId, tender_id: tenderId, current: true, extracted_text: '   ' }],
});
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 1, client: blankTextClient }),
  /texto/i,
  'debe rechazar una versión con extracted_text legado en blanco',
);

const nullTextClient = makeClient({
  versions: [{ id: versionPendingId, opportunity_id: opportunityId, tender_id: tenderId, current: true, extracted_text: null }],
});
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 1, client: nullTextClient }),
  /texto/i,
  'debe rechazar una versión sin extracted_text legado',
);

const dbErrorClient = makeClient({
  getError: { prefix: 'psi_tender_document_versions?', error: new Error('Supabase respondió HTTP 500') },
});
await assert.rejects(
  () => buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: dbErrorClient }),
  /HTTP 500/,
  'un error de la base de datos al consultar versiones debe propagarse, no silenciarse',
);

// --- el reporte nunca expone el texto extraído -------------------------------

const report = summarizePlan(plan);
const reportJson = JSON.stringify(report);
assert.ok(!reportJson.includes(legacyText), 'el reporte del plan no debe contener el texto legado íntegro');
assert.ok(!/extracted_text/i.test(reportJson), 'el reporte del plan no debe declarar el campo de texto crudo');
assert.ok(reportJson.includes(legacyTextHash), 'el reporte puede exponer el hash del texto sin exponer el texto');

// --- commit exclusivamente vía psi_backfill_legacy_tender_document_extraction ------

const commitClient = makeClient({ extractions: [{ ...existingOkExtraction }] });
const commitPlan = await buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: commitClient });
const commitResult = await executeBackfill({ client: commitClient, plan: commitPlan });

assert.equal(commitClient.rpcCalls.length, 1, 'solo debe insertar la versión pendiente, no la que ya tenía status=ok');
assert.equal(commitClient.rpcCalls[0].name, 'psi_backfill_legacy_tender_document_extraction');
assert.equal(commitClient.rpcCalls[0].payload.p_document_version_id, versionPendingId);
assert.deepEqual(
  Object.keys(commitClient.rpcCalls[0].payload).sort(),
  ['p_actor_id', 'p_char_count', 'p_document_version_id', 'p_extracted_text', 'p_opportunity_id', 'p_tender_id', 'p_text_byte_count', 'p_text_hash'].sort(),
  'debe enviar únicamente los parámetros que el RPC atómico legado acepta, nunca extractor_version/status/parser/metadata/gap_reason',
);
assert.ok(
  commitClient.getCalls.filter(path => path.startsWith('psi_tender_document_extractions?')).length >= 2,
  'debe releer psi_tender_document_extractions después de comprometer para verificar lo persistido',
);
assert.equal(commitResult.verifiedCount, 1);
assert.ok(!JSON.stringify(commitResult).includes(legacyText), 'el resultado del commit no debe exponer el texto extraído');

const rpcErrorClient = makeClient({ extractions: [{ ...existingOkExtraction }], rpcError: new Error('Supabase RPC falló') });
const rpcErrorPlan = await buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: rpcErrorClient });
await assert.rejects(
  () => executeBackfill({ client: rpcErrorClient, plan: rpcErrorPlan }),
  /RPC falló/,
  'un error del RPC de escritura debe propagarse en vez de reportarse como éxito parcial',
);

function makeReadbackMismatchClient() {
  const getCalls = [];
  const extractions = [{ ...existingOkExtraction }];
  return {
    getCalls,
    async get(path) {
      getCalls.push(path);
      if (path.startsWith('psi_sales_profiles?')) return [activeHumanProfile];
      if (path.startsWith('psi_tender_document_versions?')) return versionRows;
      if (path.startsWith('psi_tender_document_extractions?')) return extractions;
      throw new Error(`GET inesperado: ${path}`);
    },
    async rpc(name, payload) {
      assert.equal(name, 'psi_backfill_legacy_tender_document_extraction');
      // Simula una lectura posterior corrupta/desincronizada: el hash persistido
      // no coincide con el que se pidió grabar.
      extractions.push({
        document_version_id: payload.p_document_version_id,
        extractor_version: 'legacy-version-register@1',
        status: 'ok',
        text_hash: '0'.repeat(64),
      });
      return { status: 'created' };
    },
  };
}
const mismatchClient = makeReadbackMismatchClient();
const mismatchPlan = await buildBackfillPlan({ opportunityId, actorId, expectedCount: 2, client: mismatchClient });
await assert.rejects(
  () => executeBackfill({ client: mismatchClient, plan: mismatchPlan }),
  /verificaci/i,
  'debe fallar si la relectura posterior al commit no coincide con lo que se pidió persistir',
);

console.log('AGT-002 legacy extraction backfill operator contract passed');
