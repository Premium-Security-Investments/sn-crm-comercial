// TDD (RED) — el hueco documental debe quedar LIGADO al snapshot inmutable, no
// solo narrado en una interacción o en un evento.
//
// Lo que ya funciona (y este archivo NO vuelve a probar): un gap tipado que
// llega a `buildTenderRequirementInventory({ documentGaps })` degrada la
// cobertura y bloquea `decision_ready`
// (tests/tender-secop-complete-coverage-fail-closed.test.mjs).
//
// Lo que NO funciona hoy, y es un fail-closed abierto de punta a punta:
//
//   1. `buildTenderSnapshotInput` canoniza SOLO documentos. La identidad del
//      snapshot (`document_hash`) es idéntica con y sin huecos, así que el
//      expediente degradado puede reutilizar —append-only mediante— la misma
//      identidad que el expediente íntegro. El hueco no es parte del hecho
//      inmutable: es una nota al margen.
//   2. `registerTenderDocumentSnapshot` publica `p_document_manifest` sin
//      `document_gaps`, de modo que el manifiesto gobernado tampoco lo lleva.
//   3. `loadAgt002TenderRequirementDocumentGaps` lee ÚNICAMENTE estados de
//      import items. Una extracción persistida como `status='gap'` (un ZIP
//      oficial con entradas ilegibles) convive con un import item
//      `status='imported'`: para el loader no hay hueco alguno, y el gap
//      desaparece antes de AGT-002.
//   4. El refresco síncrono SECOP/ESU calcula `officialCoverageGaps` y lo
//      escribe en la interacción... y ahí muere. El snapshot que publica a
//      continuación no lo recibe.
//   5. El worker durable pasa los `gapDetails` del chunking a un evento, pero
//      `publishSnapshot` ya registró el snapshot sin ellos, así que
//      `requestAgt002` (que resuelve sus huecos por el loader del punto 3)
//      nunca los ve.
//   6. `importOneDocument` devuelve `hasText: true` fijo, ignorando el
//      `extraction_status` tipado que `refreshOfficialTenderDocument` sí
//      calcula: un ZIP cuya extracción es `gap` cuenta como texto utilizable y
//      empuja el job a `ready_for_snapshot`.
//
// Este archivo cierra ese circuito y, a la vez, fija que cerrarlo no afloje
// nada: paridad byte a byte entre backends, GO exclusivamente humano, sin
// filtración de texto/rutas/URLs firmadas (SSRF) por la vía del hueco, e
// identidad append-only/idempotente.
//
// Ejecutar: node tests/tender-snapshot-document-gaps-fail-closed.test.mjs

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  buildTenderSnapshotInput,
  registerSiioRulesAnalysis,
  registerTenderDocumentSnapshot,
} from '../tender-analysis-foundation.js';
import { loadAgt002TenderRequirementDocumentGaps } from '../agt002-tender-requirement-gaps.js';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';
import {
  buildTenderSemanticManifest,
  resolveTenderSemanticDecisionFrontier,
} from '../tender-semantic-manifest.js';
import { extractTenderDocumentText } from '../tender-document-text-extraction.js';
import { refreshOfficialTenderDocument } from '../tender-document-versioning.js';
import { createTenderProcessingWorker } from '../tender-processing-worker.js';
import { TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON } from '../tender-official-document-coverage.js';
import {
  ARCHIVE_TXT_CONTENT,
  buildMixedEntriesArchive,
} from './fixtures/tender-document-archive-fixtures.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

// Serialización estable con claves ordenadas: la MISMA que usa
// tender-analysis-foundation.js para hashear. Se reproduce aquí solo para poder
// afirmar, sin fijar un literal opaco, que la identidad de un expediente SIN
// huecos sigue siendo exactamente `sha256(documentos canónicos)` — es decir, la
// identidad que ya está persistida en psi_tender_document_snapshots.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}
const stableSha256 = value => sha256(JSON.stringify(stable(value)));

const SNAPSHOT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const JOB_ID = 'job-secop-2026';
const ZIP_DOCUMENT_ID = 'secop-formatos-zip';
const OMITTED_DOCUMENT_ID = 'SECOP-DOC-0007';
const ARCHIVE_GAP_REASON = 'archive_incomplete_extraction';

// Mismos textos de requisitos que el contrato hermano
// (tests/tender-secop-complete-coverage-fail-closed.test.mjs), para que la
// disposición semántica de este archivo se apoye en un expediente que ya está
// probado que llega a `complete` / `ready_for_human_review` sin huecos.
const PLIEGO_TEXT = [
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  'REQUISITOS TÉCNICOS',
  'Capacitación en accesibilidad: el contratista deberá certificar capacitación en accesibilidad para todo el personal operativo.',
  'El presente capítulo describe el objeto contractual y su alcance general.',
].join('\n');

const ANEXO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
].join('\n');

const COMPANY_PROFILE = { nit: '900123456-7', razon_social: 'SIIO SAS' };

// Los documentos del snapshot son los MISMOS en todos los escenarios de huecos:
// lo único que cambia es la lista de gaps. Es la única forma de probar que la
// identidad del snapshot depende del hueco y no, por accidente, del contenido.
const SNAPSHOT_DOCUMENTS = [
  {
    source_document_id: 'SECOP-DOC-0001',
    name: 'PLIEGO DEFINITIVO.pdf',
    document_type: 'pliego',
    extracted_text: PLIEGO_TEXT,
    content_hash: sha256(PLIEGO_TEXT),
    current: true,
  },
  {
    source_document_id: 'SECOP-DOC-0002',
    name: 'ANEXO TECNICO.pdf',
    document_type: 'anexo_tecnico',
    extracted_text: ANEXO_TEXT,
    content_hash: sha256(ANEXO_TEXT),
    current: true,
  },
];

// Vocabulario cerrado de un hueco documental gobernado: la MISMA forma de 4
// claves que ya consume `buildAgt002TenderRequirementInventory`
// (agt002-preview-input.js). Ni una clave más: nada de texto, rutas, URLs ni
// mensajes de error puede viajar por aquí.
const GAP_KEYS = ['document_id', 'document_type', 'name', 'reason'];

// Orden canónico de los huecos: por identidad documental y luego por motivo,
// exactamente la misma regla que ya usa `loadAgt002TenderRequirementDocumentGaps`.
// Se aplica aquí a la expectativa (en vez de fijar una lista escrita a mano) para
// afirmar el CONTENIDO y el determinismo sin depender de los detalles de
// colación de `localeCompare` para identificadores de distinta caja.
const canonicalGapOrder = gaps => [...gaps].sort((left, right) => (
  left.document_id.localeCompare(right.document_id) || left.reason.localeCompare(right.reason)
));

const ARCHIVE_GAP = {
  document_id: ZIP_DOCUMENT_ID,
  document_type: 'formatos',
  name: 'FORMATOS OFICIALES.zip',
  reason: ARCHIVE_GAP_REASON,
};

const OMITTED_GAP = {
  document_id: OMITTED_DOCUMENT_ID,
  document_type: null,
  name: 'ANALISIS DEL SECTOR.pdf',
  reason: TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON,
};

/**
 * Ni el almacenamiento ni la red pueden viajar por la traza de cobertura: una
 * ruta de bucket o una URL de descarga firmada convertirían el hueco en un
 * canal de fuga (y, del lado del consumidor, en un vector SSRF).
 */
function assertNoStorageOrNetworkLeak(serialized, label) {
  assert.equal(serialized.includes('tender-documents/'), false, `${label}: no puede arrastrar rutas de almacenamiento`);
  assert.equal(serialized.includes('token='), false, `${label}: no puede arrastrar URLs firmadas`);
  assert.equal(serialized.includes('community.secop.gov.co'), false, `${label}: no puede arrastrar endpoints oficiales`);
  assert.equal(serialized.includes('https://'), false, `${label}: nunca lleva una URL descargable (SSRF)`);
}

/** Un hueco, además, jamás lleva contenido del documento. */
function assertGapIsSafe(serialized, label) {
  assertNoStorageOrNetworkLeak(serialized, label);
  assert.equal(serialized.includes(ARCHIVE_TXT_CONTENT), false, `${label}: el hueco no arrastra texto de las entradas del paquete`);
  assert.equal(serialized.includes(PLIEGO_TEXT), false, `${label}: el hueco no arrastra texto del documento`);
}

// ===========================================================================
// 1. IDENTIDAD: el hueco es parte del insumo canónico del snapshot.
// ===========================================================================
{
  const clean = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE);

  // Compatibilidad append-only: un expediente SIN huecos conserva exactamente la
  // identidad que ya está persistida en psi_tender_document_snapshots
  // (`sha256(documentos canónicos)`). Si esa identidad cambiara al introducir los
  // huecos, TODO snapshot histórico dejaría de casar con sus documentos y
  // `getCurrentTenderAnalysis` marcaría `current: false` en masa.
  assert.equal(
    clean.document_hash,
    stableSha256(clean.documents),
    'un expediente sin huecos debe conservar la identidad documental ya publicada',
  );
  assert.equal(
    buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, []).document_hash,
    clean.document_hash,
    'declarar explícitamente "sin huecos" es el mismo hecho que no declarar huecos',
  );

  assert.ok(
    Object.hasOwn(clean, 'document_gaps'),
    'el insumo canónico del snapshot debe enumerar sus huecos documentales, aunque no haya ninguno',
  );
  assert.deepEqual(clean.document_gaps, [], 'sin huecos, la enumeración es una lista vacía, nunca ausente');

  // Un hueco declarado se canoniza a la forma cerrada, ordenada y deduplicada.
  const gapped = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, [OMITTED_GAP, ARCHIVE_GAP]);
  assert.deepEqual(
    gapped.document_gaps,
    canonicalGapOrder([OMITTED_GAP, ARCHIVE_GAP]),
    'los huecos se canonizan ordenados por identidad documental, no en el orden en que los produjo el importador',
  );
  for (const gap of gapped.document_gaps) {
    assert.deepEqual(Object.keys(gap).sort(), GAP_KEYS, `claves exactas del hueco ${gap.document_id}`);
  }

  // Los documentos NO cambian: lo único que se movió es el hueco.
  assert.deepEqual(gapped.documents, clean.documents, 'declarar un hueco no puede alterar el manifiesto documental');
  assert.equal(gapped.profile_hash, clean.profile_hash, 'declarar un hueco no puede alterar la identidad del perfil');

  // ...y aun así la identidad del snapshot cambia: un expediente con hueco
  // JAMAS puede reutilizar la identidad del expediente íntegro.
  assert.notEqual(
    gapped.document_hash,
    clean.document_hash,
    'un expediente con huecos no puede compartir identidad documental con el expediente íntegro',
  );

  // Idempotencia: mismos huecos (en otro orden, duplicados y con claves ajenas
  // que deben descartarse) => misma identidad, byte a byte.
  const repeat = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, [
    { ...ARCHIVE_GAP, storage_path: 'tender-documents/opp/secop-formatos-zip/deadbeef-FORMATOS.zip' },
    { ...OMITTED_GAP, source_url: 'https://community.secop.gov.co/descarga?token=abc123' },
    { ...ARCHIVE_GAP },
  ]);
  assert.deepEqual(repeat.document_gaps, gapped.document_gaps, 'reejecutar con los mismos huecos produce la misma enumeración');
  assert.equal(repeat.document_hash, gapped.document_hash, 'reejecutar con los mismos huecos es idempotente en identidad');
  assertGapIsSafe(JSON.stringify(repeat.document_gaps), 'insumo canónico');

  // Un motivo distinto es un hecho distinto: la identidad debe moverse.
  const otherReason = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, [
    OMITTED_GAP,
    { ...ARCHIVE_GAP, reason: 'unsafe_entry_path' },
  ]);
  assert.notEqual(otherReason.document_hash, gapped.document_hash, 'cambiar el motivo del hueco cambia la identidad del snapshot');

  // Resolver un hueco tampoco puede pasar desapercibido.
  const partiallyResolved = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, [ARCHIVE_GAP]);
  assert.notEqual(partiallyResolved.document_hash, gapped.document_hash, 'resolver un hueco cambia la identidad del snapshot');
  assert.notEqual(partiallyResolved.document_hash, clean.document_hash);
}

// ===========================================================================
// 2. PUBLICACIÓN: el manifiesto gobernado lleva los huecos cerrados.
// ===========================================================================
function fakeSnapshotDatabase() {
  const rpcCalls = [];
  return {
    rpcCalls,
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === 'psi_record_tender_document_snapshot') {
        return { data: { id: SNAPSHOT_ID, document_hash: params.p_document_hash, profile_hash: params.p_profile_hash } };
      }
      if (name === 'psi_record_tender_analysis_run') {
        return { data: { id: 'run-1', status: 'completed', critical_open_count: 0 } };
      }
      throw new Error(`RPC inesperada: ${name}`);
    },
  };
}

{
  const database = fakeSnapshotDatabase();
  const expected = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, [ARCHIVE_GAP, OMITTED_GAP]);
  const registered = await registerTenderDocumentSnapshot(database, {
    opportunity_id: 'opp-1',
    tender_id: 'tender-1',
    actor_id: 'actor-1',
    refresh_token: 'refresh-token-1',
    documents: SNAPSHOT_DOCUMENTS,
    company_profile: COMPANY_PROFILE,
    document_gaps: [ARCHIVE_GAP, OMITTED_GAP],
  });

  const [{ params }] = database.rpcCalls;
  assert.equal(params.p_document_hash, expected.document_hash, 'el hash publicado debe ser el del insumo canónico con huecos');
  assert.deepEqual(
    params.p_document_manifest,
    { documents: expected.documents, document_gaps: expected.document_gaps },
    'el manifiesto gobernado debe llevar los huecos junto a los documentos, no solo los documentos',
  );
  assert.deepEqual(registered.document_gaps, expected.document_gaps, 'el snapshot registrado devuelve sus huecos ya canonizados');
  assertGapIsSafe(JSON.stringify(params.p_document_manifest.document_gaps), 'manifiesto gobernado');

  // Append-only/idempotencia: republicar el MISMO expediente con los MISMOS
  // huecos produce parámetros byte-idénticos (la RPC deduplica por hash).
  const twin = fakeSnapshotDatabase();
  await registerTenderDocumentSnapshot(twin, {
    opportunity_id: 'opp-1',
    tender_id: 'tender-1',
    actor_id: 'actor-1',
    refresh_token: 'refresh-token-1',
    documents: [...SNAPSHOT_DOCUMENTS].reverse(),
    company_profile: COMPANY_PROFILE,
    document_gaps: [OMITTED_GAP, ARCHIVE_GAP],
  });
  assert.deepEqual(twin.rpcCalls[0].params, params, 'la publicación gobernada es determinista frente al orden de entrada');
}

{
  // El análisis por reglas comparte el snapshot gobernado del refresco: si el
  // snapshot se publicó CON huecos, el análisis debe reconstruir esa misma
  // identidad. Un análisis que ignore los huecos ya no puede hacerse pasar por
  // el mismo expediente.
  const database = fakeSnapshotDatabase();
  const governed = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE, [ARCHIVE_GAP]);
  const snapshotRecord = { id: SNAPSHOT_ID, document_hash: governed.document_hash, profile_hash: governed.profile_hash };

  const run = await registerSiioRulesAnalysis(database, {
    opportunity_id: 'opp-1',
    tender_id: 'tender-1',
    actor_id: 'actor-1',
    documents: SNAPSHOT_DOCUMENTS,
    company_profile: COMPANY_PROFILE,
    document_gaps: [ARCHIVE_GAP],
    snapshot_record: snapshotRecord,
    result: { recommendation: 'pause', summary: 'Expediente incompleto.', questions: [] },
  });
  assert.equal(run.snapshot_id, SNAPSHOT_ID);

  await assert.rejects(
    registerSiioRulesAnalysis(fakeSnapshotDatabase(), {
      opportunity_id: 'opp-1',
      tender_id: 'tender-1',
      actor_id: 'actor-1',
      documents: SNAPSHOT_DOCUMENTS,
      company_profile: COMPANY_PROFILE,
      document_gaps: [],
      snapshot_record: snapshotRecord,
      result: { recommendation: 'pause', summary: 'Expediente incompleto.', questions: [] },
    }),
    /snapshot documental gobernado no coincide/,
    'analizar como íntegro un snapshot publicado con huecos debe fallar cerrado',
  );
}

// ===========================================================================
// 3. LECTURA: el loader de huecos fusiona manifiesto inmutable + import items.
// ===========================================================================
function fakeGapDatabase({ snapshot = null, job = null, items = [], errors = {} } = {}) {
  const calls = [];
  const sourceFor = table => {
    if (table === 'psi_tender_document_snapshots') return { single: snapshot, list: snapshot ? [snapshot] : [], error: errors.snapshot ?? null };
    if (table === 'psi_tender_processing_jobs') return { single: job, list: job ? [job] : [], error: errors.job ?? null };
    if (table === 'psi_tender_document_import_items') return { single: null, list: items, error: errors.items ?? null };
    throw new Error(`Tabla inesperada: ${table}`);
  };
  return {
    calls,
    from(table) {
      const operations = [];
      calls.push({ table, operations });
      const source = sourceFor(table);
      return {
        select(value) { operations.push(['select', value]); return this; },
        eq(column, value) { operations.push(['eq', column, value]); return this; },
        order(column, options) { operations.push(['order', column, options]); return this; },
        limit(value) { operations.push(['limit', value]); return this; },
        async maybeSingle() { return { data: source.single, error: source.error }; },
        async single() { return { data: source.single, error: source.error }; },
        then(resolve, reject) { return Promise.resolve({ data: source.list, error: source.error }).then(resolve, reject); },
      };
    },
  };
}

// Manifiesto tal y como queda persistido en psi_tender_document_snapshots: los
// documentos canónicos que produce la propia función de producción, y los huecos
// escritos explícitamente (el fixture no depende de la corrección bajo prueba).
const CANONICAL_DOCUMENTS = buildTenderSnapshotInput(SNAPSHOT_DOCUMENTS, COMPANY_PROFILE).documents;
const persistedSnapshotRow = documentGaps => ({
  id: SNAPSHOT_ID,
  document_manifest: { documents: CANONICAL_DOCUMENTS, document_gaps: documentGaps },
});
const PERSISTED_MANIFEST_ROW = persistedSnapshotRow([ARCHIVE_GAP, OMITTED_GAP]);

{
  // El caso exacto que hoy se pierde: el ZIP se importó (`imported`), su
  // extracción quedó como `gap`, y el hueco solo vive en el manifiesto.
  const database = fakeGapDatabase({
    snapshot: PERSISTED_MANIFEST_ROW,
    job: { id: JOB_ID },
    items: [
      { id: 'item-zip', source_document_id: ZIP_DOCUMENT_ID, name: 'FORMATOS OFICIALES.zip', status: 'imported' },
      { id: 'item-pliego', source_document_id: 'SECOP-DOC-0001', name: 'PLIEGO DEFINITIVO.pdf', status: 'imported' },
      { id: 'item-adenda', source_document_id: 'SECOP-DOC-0003', name: 'ADENDA 1.pdf', status: 'processing' },
    ],
  });

  const gaps = await loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: SNAPSHOT_ID, jobId: JOB_ID });

  assert.ok(
    database.calls.some(call => call.table === 'psi_tender_document_snapshots'),
    'el loader debe leer el manifiesto inmutable del snapshot, no solo los import items',
  );
  assert.deepEqual(
    gaps,
    canonicalGapOrder([
      ARCHIVE_GAP,
      OMITTED_GAP,
      { document_id: 'SECOP-DOC-0003', document_type: null, name: 'ADENDA 1.pdf', reason: 'processing' },
    ]),
    'los huecos del manifiesto inmutable y los del job se fusionan en un orden determinista',
  );
  for (const gap of gaps) {
    assert.deepEqual(Object.keys(gap).sort(), GAP_KEYS, `claves exactas del hueco ${gap.document_id}`);
  }
  assert.equal(
    gaps.some(gap => gap.reason === ARCHIVE_GAP_REASON),
    true,
    'una extracción de ZIP persistida como gap no puede desaparecer solo porque su import item diga imported',
  );

  // Determinismo real: releer el mismo snapshot produce la misma lista.
  const rerun = await loadAgt002TenderRequirementDocumentGaps(
    fakeGapDatabase({
      snapshot: PERSISTED_MANIFEST_ROW,
      job: { id: JOB_ID },
      items: [
        { id: 'item-adenda', source_document_id: 'SECOP-DOC-0003', name: 'ADENDA 1.pdf', status: 'processing' },
        { id: 'item-pliego', source_document_id: 'SECOP-DOC-0001', name: 'PLIEGO DEFINITIVO.pdf', status: 'imported' },
        { id: 'item-zip', source_document_id: ZIP_DOCUMENT_ID, name: 'FORMATOS OFICIALES.zip', status: 'imported' },
      ],
    }),
    { snapshotId: SNAPSHOT_ID, jobId: JOB_ID },
  );
  assert.deepEqual(rerun, gaps, 'la fusión no puede depender del orden en que la base devolvió las filas');
  assertGapIsSafe(JSON.stringify(gaps), 'loader AGT-002');
}

{
  // Dedup determinista: el MISMO (document_id, reason) por las dos vías es un
  // solo hueco, y el manifiesto no puede duplicar lo que el job ya reporta.
  const database = fakeGapDatabase({
    snapshot: {
      id: SNAPSHOT_ID,
      document_manifest: {
        documents: [],
        document_gaps: [
          { document_id: 'SECOP-DOC-0003', document_type: null, name: 'ADENDA 1.pdf', reason: 'processing' },
          ARCHIVE_GAP,
          ARCHIVE_GAP,
        ],
      },
    },
    job: { id: JOB_ID },
    items: [{ id: 'item-adenda', source_document_id: 'SECOP-DOC-0003', name: 'ADENDA 1.pdf', status: 'processing' }],
  });
  const gaps = await loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: SNAPSHOT_ID, jobId: JOB_ID });
  assert.deepEqual(
    gaps,
    canonicalGapOrder([
      ARCHIVE_GAP,
      { document_id: 'SECOP-DOC-0003', document_type: null, name: 'ADENDA 1.pdf', reason: 'processing' },
    ]),
    'un mismo (document_id, reason) por manifiesto y por job colapsa en un único hueco',
  );
}

{
  // Un snapshot sin job de importación (carga manual, reanálisis) conserva sus
  // huecos: el manifiesto inmutable es fuente por sí mismo.
  const database = fakeGapDatabase({ snapshot: PERSISTED_MANIFEST_ROW, job: null, items: [] });
  const gaps = await loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: SNAPSHOT_ID });
  assert.deepEqual(
    gaps.map(gap => gap.document_id).sort(),
    [OMITTED_DOCUMENT_ID, ZIP_DOCUMENT_ID].sort(),
    'sin job de importación, los huecos del manifiesto inmutable siguen siendo visibles',
  );
}

{
  // Fail-closed: si el manifiesto no se puede leer, se levanta el error; jamás
  // se reporta "no hay huecos".
  const database = fakeGapDatabase({
    job: { id: JOB_ID },
    items: [],
    errors: { snapshot: new Error('snapshots query failed') },
  });
  await assert.rejects(
    loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: SNAPSHOT_ID, jobId: JOB_ID }),
    /snapshots query failed/,
    'un manifiesto ilegible nunca puede degradarse a "expediente íntegro"',
  );
}

// ===========================================================================
// 4/5. CABLEADO: refresco síncrono y worker durable atan el hueco al snapshot.
//      Ambas rutas viven en los dos backends, que deben seguir siendo
//      byte-idénticos.
// ===========================================================================
const BACKENDS = ['../api/[...path].js', '../server/index.js'].map(path => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), 'utf8'),
}));
assert.equal(BACKENDS[0].source, BACKENDS[1].source, 'los backends serverless y local deben permanecer byte-identical');

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${label}: no se encontró ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${label}: no se encontró ${endMarker} después de ${startMarker}`);
  return source.slice(start, end);
}

for (const { path, source } of BACKENDS) {
  // --- 4. Refresco síncrono SECOP/ESU ------------------------------------
  const refresh = source.match(/async function refreshTenderDocumentsFromOfficialSource[\s\S]*?\n}\nasync function convertTenderToOpportunity/);
  assert.ok(refresh, `${path} debe conservar el refresco documental oficial gobernado`);
  const refreshBody = refresh[0];

  // Control: la traza en la interacción se conserva (no se sustituye, se suma).
  assert.match(refreshBody, /official_document_gaps: officialCoverageGaps/, `${path} debe seguir trazando las omisiones oficiales en la interacción`);

  // El snapshot que publica el refresco debe recibir los huecos.
  const refreshSnapshotCall = sliceBetween(refreshBody, 'const registeredSnapshot = await registerTenderDocumentSnapshot(database, {', '});', `${path} refresco`);
  assert.match(
    refreshSnapshotCall,
    /document_gaps:/,
    `${path} debe pasar los huecos documentales al snapshot inmutable del refresco, no solo a la interacción`,
  );

  // Y esos huecos son los DOS reales: las omisiones por tope oficial y los
  // huecos de extracción tipada de los documentos vigentes. No se prescribe el
  // nombre de la derivación, solo que el snapshot no reciba únicamente el tope.
  assert.match(
    refreshBody,
    /officialCoverageGaps/,
    `${path} debe reutilizar la enumeración de omitidos por tope como hueco del snapshot`,
  );
  const refreshGapsArgument = refreshSnapshotCall.match(/document_gaps:\s*([^,\n]+)/);
  assert.ok(refreshGapsArgument, `${path} debe nombrar el valor de document_gaps del refresco`);
  assert.notEqual(
    refreshGapsArgument[1].trim(),
    'officialCoverageGaps',
    `${path} debe sumar los huecos de extracción tipada (ZIP/PDF ilegible) a las omisiones por tope, no publicar solo el tope`,
  );

  // El análisis inmediato que cuelga del refresco comparte el mismo expediente.
  const refreshRulesCall = sliceBetween(refreshBody, 'const registered = await registerSiioRulesAnalysis(database, {', '});', `${path} refresco`);
  assert.match(
    refreshRulesCall,
    /document_gaps:/,
    `${path} debe analizar el expediente con los mismos huecos con los que publicó su snapshot`,
  );

  // --- 5/6. Worker durable ------------------------------------------------
  const deps = source.match(/function buildTenderProcessingWorkerDeps\(database\)[\s\S]*?\n}\n\nexport async function buildTenderOpportunitySummary/);
  assert.ok(deps, `${path} debe conservar el cableado del worker durable`);
  const depsBody = deps[0];

  const importOne = sliceBetween(depsBody, 'importOneDocument: async', 'chunkDocuments: async', `${path} worker`);
  assert.doesNotMatch(
    importOne,
    /hasText: true/,
    `${path} no puede declarar texto utilizable de forma fija: un ZIP cuya extracción es gap no aporta texto`,
  );
  assert.match(
    importOne,
    /extraction_status/,
    `${path} debe derivar hasText del estado tipado de extracción que ya devuelve refreshOfficialTenderDocument`,
  );

  const chunk = sliceBetween(depsBody, 'chunkDocuments: async', 'publishSnapshot: async', `${path} worker`);
  assert.match(chunk, /gapDetails/, `${path} debe seguir enumerando los gaps del chunking`);

  const publish = sliceBetween(depsBody, 'publishSnapshot: async', 'requestAgt002: async', `${path} worker`);
  assert.match(
    publish,
    /document_gaps:/,
    `${path} debe atar los huecos de extracción tipada al manifiesto del snapshot durable`,
  );
  assert.match(
    publish,
    /extraction/i,
    `${path} debe derivar los huecos durables del estado tipado de extracción de los documentos vigentes`,
  );

  // Control: AGT-002 sigue resolviendo sus huecos por el loader gobernado, que
  // es el canal por el que ahora llegan los del manifiesto inmutable.
  const agt002 = sliceBetween(depsBody, 'requestAgt002: async', '\n  };\n}', `${path} worker`);
  assert.match(
    agt002,
    /loadAgt002TenderRequirementDocumentGaps\(database, \{ snapshotId, jobId \}\)/,
    `${path} debe seguir resolviendo los huecos del snapshot antes de invocar a Vig-IA`,
  );
}

// ===========================================================================
// 6. ZIP IMPORTADO CON EXTRACCIÓN EN GAP: ni texto utilizable, ni expediente
//    completo, ni disposición.
// ===========================================================================
const zipExtraction = await extractTenderDocumentText(buildMixedEntriesArchive(), 'FORMATOS OFICIALES.zip', 'application/zip');
assert.equal(zipExtraction.status, 'gap', 'control: el ZIP mixto oficial ya resuelve como extracción incompleta');
assert.equal(zipExtraction.metadata.gap_reason, ARCHIVE_GAP_REASON);

{
  // La importación oficial real persiste ese gap y NO fabrica texto.
  const recorded = [];
  const result = await refreshOfficialTenderDocument({
    opportunityId: 'opp-1',
    source: 'SECOP II',
    document: {
      name: 'FORMATOS OFICIALES.zip',
      mime_type: 'application/zip',
      document_type: 'formatos',
      source_url: 'https://community.secop.gov.co/descarga?token=abc123',
      source_document_id: ZIP_DOCUMENT_ID,
    },
    currentVersion: null,
    download: () => buildMixedEntriesArchive(),
    extractText: (buffer, name, mime) => extractTenderDocumentText(buffer, name, mime),
    ensureStorage: async () => {},
    upload: async () => {},
    recordVersion: async version => ({ id: 'version-zip-1', ...version }),
    recordExtraction: async payload => { recorded.push(payload); },
  });

  assert.equal(result.extraction_status, 'gap', 'control: la importación oficial ya devuelve el estado tipado de extracción');
  assert.equal(recorded.length, 1, 'control: el gap de extracción se persiste tipado');
  assert.equal(recorded[0].extraction.status, 'gap');
  assert.equal(recorded[0].extraction.metadata.gap_reason, ARCHIVE_GAP_REASON);

  // El documento importado NO puede presentarse como portador de texto: es
  // exactamente el valor que el worker usa para decidir si el expediente es
  // utilizable, y hoy el backend lo fija en true (ver bloque 5/6 arriba).
  const hasText = result.extraction_status !== 'gap';
  assert.equal(hasText, false, 'un ZIP cuya extracción es gap nunca aporta texto utilizable al expediente');
}

{
  // Control del worker: con hasText false y ningún otro documento legible, el
  // job va a needs_attention y jamás publica snapshot.
  const events = [];
  const patches = [];
  const worker = createTenderProcessingWorker({
    claimJob: async () => ({
      job_id: JOB_ID, lease_id: 'lease-1', tender_id: 'tender-1', opportunity_id: 'opp-1',
      status: 'importing_documents', current_step: 'documents', analysis_authorized_by: null,
      pending_documents: [{ source: 'SECOP II', sourceDocumentId: ZIP_DOCUMENT_ID, sourceUrl: 'x', name: 'FORMATOS OFICIALES.zip', critical: true }],
    }),
    updateJob: async (jobId, leaseId, patch) => { patches.push(patch); },
    recordImportItem: async () => {},
    appendEvent: async event => { events.push(event); },
    revalidateOfficialStatus: async () => ({ terminal: false }),
    discoverDocuments: async () => ({ items: [], coverage: null }),
    importOneDocument: async () => ({ status: 'imported', hasText: false, documentVersionId: 'version-zip-1' }),
    publishSnapshot: async () => { throw new Error('un expediente sin texto utilizable nunca debe publicar snapshot'); },
    requestAgt002: async () => { throw new Error('un expediente sin texto utilizable nunca debe invocar a Vig-IA'); },
    now: () => 0,
  });
  const outcome = await worker.runOnce({});
  assert.equal(outcome.status, 'needs_attention', 'control: sin texto utilizable el job queda en needs_attention');
  assert.equal(patches.at(-1).status, 'needs_attention');
  assert.ok(!events.some(event => event.eventType === 'snapshot_published'));
}

{
  // Punta a punta: el hueco del ZIP, que solo vive en el manifiesto inmutable,
  // llega al inventario y bloquea la disposición — aunque TODO lo analizable se
  // haya analizado y el import item diga `imported`.
  const database = fakeGapDatabase({
    snapshot: persistedSnapshotRow([ARCHIVE_GAP]),
    job: { id: JOB_ID },
    items: [
      { id: 'item-zip', source_document_id: ZIP_DOCUMENT_ID, name: 'FORMATOS OFICIALES.zip', status: 'imported' },
      { id: 'item-pliego', source_document_id: 'SECOP-DOC-0001', name: 'PLIEGO DEFINITIVO.pdf', status: 'imported' },
      { id: 'item-anexo', source_document_id: 'SECOP-DOC-0002', name: 'ANEXO TECNICO.pdf', status: 'imported' },
    ],
  });
  const documentGaps = await loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: SNAPSHOT_ID, jobId: JOB_ID });
  assert.deepEqual(
    documentGaps.map(gap => [gap.document_id, gap.reason]),
    [[ZIP_DOCUMENT_ID, ARCHIVE_GAP_REASON]],
    'el hueco de extracción del ZIP debe sobrevivir hasta AGT-002 pese al import item imported',
  );

  // Misma forma de documento analizable que el contrato hermano ya probado.
  const analyzedDocuments = SNAPSHOT_DOCUMENTS.map(document => ({
    document_id: document.source_document_id,
    document_version_id: `${document.source_document_id}-v1`,
    content_hash: document.content_hash,
    extracted_text: document.extracted_text,
    document_type: 'pliego',
    name: `${document.source_document_id}.pdf`,
    current: true,
  }));

  const inventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents: analyzedDocuments, documentGaps });
  assert.equal(inventory.expedient_coverage.status, 'partial', 'un ZIP sin extraer impide declarar cobertura integral del expediente');
  assert.equal(inventory.coverage_ledger.unresolved_visible_count, 1);

  const manifest = buildTenderSemanticManifest({ inventory, documents: analyzedDocuments });
  const finalized = resolveTenderSemanticDecisionFrontier({
    semanticManifest: manifest,
    inventory,
    documents: analyzedDocuments,
    analyzedRequirementIds: manifest.requirements.map(requirement => requirement.requirement_id),
    analyzedSourceUnitIds: inventory.source_units.map(unit => unit.source_unit_id),
  });
  assert.equal(finalized.decision_ready, false, 'con el ZIP sin extraer no hay disposición, por completo que sea el análisis');
  assert.equal(finalized.recommendation, 'pause');
  // El GO sigue siendo humano en todo caso.
  assert.equal(finalized.human_review_required, true);
  assert.notEqual(finalized.recommendation, 'go');

  const serializedInventory = JSON.stringify(inventory);
  assertNoStorageOrNetworkLeak(serializedInventory, 'inventario');
  assert.equal(
    serializedInventory.includes(ARCHIVE_TXT_CONTENT),
    false,
    'inventario: el hueco del ZIP no arrastra el texto de las entradas del paquete',
  );
}

console.log('tender-snapshot-document-gaps-fail-closed.test.mjs OK');
