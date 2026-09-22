// AGT-002 durable resumed job — AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY runtime wiring (RED, no
// production change).
//
// getAgt002PreviewRuntimeConfig has no `semanticBatchConcurrency` field and reads no
// `AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY` env key today, so every config-level assertion below
// fails immediately (`undefined` where a number is expected, or no throw where one is required).
//
// createAgt002PreviewRuntime wires `semanticDiscoveryProvider: discoverTenderSemanticManifest`
// (agt002-preview-runtime.js) as the raw, unwrapped function reference — it forwards no
// `batchConcurrency` of any kind. The forwarding test below proves that with the SAME bounded,
// deferred-promise technique used in tests/tender-semantic-discovery-batch-concurrency.test.mjs:
// invoking the captured provider directly, over a real two-batch expediente, must start both
// batches before either resolves once AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY=2 is set — which
// requires BOTH the config field above to exist AND the runtime to actually pass it through on
// every call, not just one or the other. No production file is touched by this test.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { getAgt002PreviewRuntimeConfig, createAgt002PreviewRuntime } from '../agt002-preview-runtime.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION } from '../agt002-company-evidence-sharepoint-catalog.js';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';

function baseEnv(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'sonnet',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Config-level: getAgt002PreviewRuntimeConfig().semanticBatchConcurrency, mirroring every other
// AGT002_PREVIEW_* numeric override in this module (default when absent, honored verbatim when a
// valid integer, fail-closed otherwise — see AGT002_PREVIEW_MAX_CONCURRENT above).
// ---------------------------------------------------------------------------------------------
assert.equal(
  getAgt002PreviewRuntimeConfig(baseEnv()).semanticBatchConcurrency, 1,
  'ausente AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY debe usar la concurrencia secuencial por defecto (1)',
);
assert.equal(
  getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: '2' })).semanticBatchConcurrency, 2,
  'AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY=2 debe honrarse verbatim',
);
for (const badValue of ['0', '3', '4', 'abc', '1.5', '-1', '10']) {
  assert.throws(
    () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: badValue })),
    /no está configurado/i,
    `AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY=${badValue} debe fallar cerrado (sólo se permiten los enteros 1 o 2)`,
  );
  assert.throws(
    () => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: badValue }), countDailyRuns: async () => 0 }),
    /no está configurado/i,
    `createAgt002PreviewRuntime debe fallar cerrado igual que getAgt002PreviewRuntimeConfig para ${badValue}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Exact-string acceptance: only the RAW strings '1' and '2' may ever set semanticBatchConcurrency.
// The current implementation reads the env value through `Number(...)`, which silently coerces
// whitespace padding, decimals, exponential notation, hex notation, and zero-padded digits into
// the same numeric value — every case below proves that coercion must NOT happen: an explicit but
// non-exact value must fail closed, never be accepted as if it were '1' or '2', and never be
// silently treated as absent (empty/whitespace-only) either.
// ---------------------------------------------------------------------------------------------
assert.equal(
  getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: '1' })).semanticBatchConcurrency, 1,
  'AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY="1" debe honrarse verbatim (cadena exacta)',
);

const EXACT_STRING_INVALID_VALUES = [
  '', // empty string: explicit but invalid, must fail closed — not be treated as "absent" (default)
  ' ', // whitespace-only: same — trim()-based emptiness checks must not swallow this into the default
  '\t',
  ' 2 ', // whitespace-padded — Number(' 2 ') === 2, but the raw string is not '2'
  ' 2',
  '2 ',
  '2.0', // decimal — Number('2.0') === 2
  '2e0', // exponential — Number('2e0') === 2
  '0x2', // hex — Number('0x2') === 2
  '01', // zero-padded — Number('01') === 1
  0, // non-string (actual number 0), not the accepted string '1' or '2'
  3, // non-string (actual number 3)
];
for (const badValue of EXACT_STRING_INVALID_VALUES) {
  assert.throws(
    () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: badValue })),
    /no está configurado/i,
    `AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY=${JSON.stringify(badValue)} debe fallar cerrado (sólo se aceptan las cadenas exactas "1" o "2", nunca una variante numéricamente equivalente vía Number(...) ni un valor no-string)`,
  );
  assert.throws(
    () => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: badValue }), countDailyRuns: async () => 0 }),
    /no está configurado/i,
    `createAgt002PreviewRuntime debe fallar cerrado igual que getAgt002PreviewRuntimeConfig para ${JSON.stringify(badValue)}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Forwarding: the V3 runtime's injected semanticDiscoveryProvider must actually carry
// AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY through to the real discoverTenderSemanticManifest on
// every call — proven behaviourally (deferred promises + a real two-batch expediente), never by
// inspecting an option object, since the runtime is free to implement the forwarding however it
// wants as long as the real discovery function actually receives it.
// ---------------------------------------------------------------------------------------------
const V3_BASE_ENV = {
  AGT002_CANONICAL_ONLY: 'true', AGT002_CONTEXT_V2: 'true', AGT002_DOCUMENT_RETRIEVAL: 'true', AGT002_INTEGRAL_CONTRACT_V3: 'true',
};
const SYNTHETIC_EVIDENCE_AS_OF = '2026-08-29T00:00:00.000Z';
const SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT = Object.freeze({
  inventory_version: AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION,
  catalog_snapshot_hash: 'c'.repeat(64),
  source_file_count: 18,
  excluded_non_evidence_count: 1,
  state_counts: {
    current_valid: 0, historical_update_required: 0, reported_unverified: 17, absent_unknown: 0, process_specific_template: 0,
  },
  classes: AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => ({
    entry_id: entryId,
    source_file_count: 1,
    state_counts: {
      current_valid: 0, historical_update_required: 0, reported_unverified: 1, absent_unknown: 0, process_specific_template: 0,
    },
    effective_state: 'reported_unverified',
    last_reconciled_at: '2026-08-29T00:00:00.000Z',
  })),
});

function captureSemanticDiscoveryProvider(environment) {
  let capturedOptions = null;
  const spyEngine = options => {
    capturedOptions = options;
    return { analyze: async () => { throw new Error('not called'); } };
  };
  createAgt002PreviewRuntime({
    environment,
    countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [],
    companyEvidenceAsOf: SYNTHETIC_EVIDENCE_AS_OF,
    companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT,
    contextVersionId: '10101010-1010-4010-8010-101010101010',
    createEngine: spyEngine,
  });
  assert.equal(typeof capturedOptions.semanticDiscoveryProvider, 'function', 'sanity: a V3 runtime must inject a semanticDiscoveryProvider function');
  return capturedOptions.semanticDiscoveryProvider;
}

// --- Two-batch expediente fixture, identical mechanics to
// tests/tender-semantic-discovery-multibatch-regression.test.mjs: doc *-a's own text alone
// consumes the whole per-batch budget, forcing doc *-b into its own later batch.
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function document(id, text) {
  return { document_id: id, document_version_id: `${id}-v1`, content_hash: hash(text), extracted_text: text };
}
const DOC_A_TEXT = 'El oferente debera acreditar experiencia especifica y verificable en la prestacion continua del servicio de vigilancia hospitalaria, aportando certificaciones expedidas por las entidades contratantes correspondientes, en las cuales conste el objeto contractual ejecutado, el plazo real de ejecucion y la calificacion final obtenida por el contratista durante toda la vigencia del contrato suscrito.';
const DOC_B_TEXT = 'El contratista entregara un informe mensual de operaciones debidamente detallado y suscrito por el supervisor designado, dentro de los primeros dias habiles de cada mes calendario de la vigencia contractual acordada entre las partes.';
const documents = [document('doc-runtime-conc-a', DOC_A_TEXT), document('doc-runtime-conc-b', DOC_B_TEXT)];
const SNAPSHOT = '77777777-7777-4777-8777-777777777041';
const inventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT, documents, documentGaps: [] });
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const unitsA = [...resolvedTexts.values()].filter(value => value.document_id === 'doc-runtime-conc-a');
const maxSourceChars = unitsA.reduce((total, value) => total + value.text.length, 0);
assert.ok(maxSourceChars > 0, 'fixture must yield a positive per-batch budget');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
function fakeGatedClient({ startedGates, resolveGates }) {
  const requests = [];
  return {
    requests,
    run: async request => {
      const batchIndex = request.input.batch.index;
      requests.push(request);
      startedGates[batchIndex].resolve();
      await resolveGates[batchIndex].promise;
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      const proposal = enumLabels.length
        ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
        : { requirements: [], excluded: [], unresolved: [] };
      return { content: JSON.stringify(proposal), usage: { input_tokens: 5, output_tokens: 5 } };
    },
  };
}

{
  const semanticDiscoveryProvider = captureSemanticDiscoveryProvider(baseEnv({ ...V3_BASE_ENV, AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY: '2' }));
  const startedGates = [deferred(), deferred()];
  const resolveGates = [deferred(), deferred()];
  const client = fakeGatedClient({ startedGates, resolveGates });

  const resultPromise = semanticDiscoveryProvider({
    client, model: 'test-model', timeoutMs: 1000, idempotencyKey: 'idem-runtime-forward-concurrency',
    inventory, documents, maxSourceChars, maxLabelCatalogChars: 40_000,
  });

  await withTimeout(
    Promise.all([startedGates[0].promise, startedGates[1].promise]),
    500,
    'RED: con AGT002_PREVIEW_DISCOVERY_BATCH_CONCURRENCY=2, el runtime debe reenviar batchConcurrency=2 al descubridor real para que ambos lotes inicien antes de que cualquiera resuelva; hoy semanticDiscoveryProvider es la función cruda sin envolver y nunca reenvía la opción',
  );

  resolveGates[0].resolve();
  resolveGates[1].resolve();
  await withTimeout(resultPromise, 1000, 'el descubrimiento debe completarse tras liberar ambos lotes');
  assert.equal(client.requests.length, 2);
}

console.log('tests/agt002-preview-runtime-batch-concurrency.test.mjs OK');
