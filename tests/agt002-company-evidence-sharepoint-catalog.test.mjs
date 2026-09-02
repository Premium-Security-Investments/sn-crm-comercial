// AGT-002 — governed SharePoint company-evidence catalog (inventory snapshot contract).
//
// RED reason: `agt002-company-evidence-sharepoint-catalog.js` does not exist on this branch,
// so the dynamic import below throws ERR_MODULE_NOT_FOUND before any assertion runs. Nothing
// here touches the network, the filesystem or a database: the module under contract must be
// pure except for ONE explicit RPC call, exercised through a fake database client.
//
// What this file pins:
//   - the closed inventory version literal and the exact five governed states;
//   - the safe snapshot shape (no item ids, names, paths, URLs, eTags, raw fingerprints, PII);
//   - the deterministic effective_state precedence and its absent_unknown floor;
//   - fail-closed total/count validation, both at build time and at re-validation time;
//   - a loader that uses exactly one RPC and NEVER degrades a missing/malformed RPC into an
//     empty inventory (silently claiming "no evidence" is the failure mode this exists to stop).
import { strict as assert } from 'node:assert';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

const modulePath = new URL('../agt002-company-evidence-sharepoint-catalog.js', import.meta.url);
const {
  AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION,
  AGT002_COMPANY_EVIDENCE_GOVERNED_STATES,
  AGT002_COMPANY_EVIDENCE_INVENTORY_RPC,
  resolveAgt002CompanyEvidenceEffectiveState,
  buildAgt002CompanyEvidenceInventorySnapshot,
  validateAgt002CompanyEvidenceInventorySnapshot,
  loadAgt002CompanyEvidenceInventorySnapshot,
} = await import(modulePath.href);

const HASH = 'c'.repeat(64);
const RECONCILED_AT = '2026-09-01T00:00:00.000Z';

function stateCounts(overrides = {}) {
  return {
    current_valid: 0,
    historical_update_required: 0,
    reported_unverified: 0,
    absent_unknown: 0,
    process_specific_template: 0,
    ...overrides,
  };
}

function total(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

/** One class input as the builder accepts it: counts only, never an effective_state. */
function classInput(entryId, counts, lastReconciledAt = RECONCILED_AT) {
  return {
    entry_id: entryId,
    source_file_count: total(counts),
    state_counts: counts,
    last_reconciled_at: lastReconciledAt,
  };
}

/** 17 classes, one reported_unverified file each — the simplest snapshot that satisfies every total. */
function baseClassInputs(overridesByEntryId = {}) {
  return AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => (
    classInput(entryId, overridesByEntryId[entryId] ?? stateCounts({ reported_unverified: 1 }))
  ));
}

function buildBase(overrides = {}) {
  return buildAgt002CompanyEvidenceInventorySnapshot({
    catalogSnapshotHash: HASH,
    sourceFileCount: 18,
    excludedNonEvidenceCount: 1,
    stateCounts: stateCounts({ reported_unverified: 17 }),
    classes: baseClassInputs(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Closed constants.
// ---------------------------------------------------------------------------
assert.equal(AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION, 'agt002-company-evidence-sharepoint-catalog-v1');
assert.deepEqual(
  [...AGT002_COMPANY_EVIDENCE_GOVERNED_STATES],
  ['current_valid', 'historical_update_required', 'reported_unverified', 'absent_unknown', 'process_specific_template'],
  'the five governed states are a closed, ordered catalog — never open-ended, never reordered silently',
);
assert.ok(Object.isFrozen(AGT002_COMPANY_EVIDENCE_GOVERNED_STATES), 'the governed state catalog must be frozen');
assert.equal(AGT002_COMPANY_EVIDENCE_INVENTORY_RPC, 'psi_get_agt002_company_evidence_inventory_snapshot');

// ---------------------------------------------------------------------------
// effective_state: a pure, deterministic derivation — never a stored/model-supplied value.
// Zero source files is ALWAYS absent_unknown (a declared documental gap); otherwise the
// precedence is current_valid > historical_update_required > reported_unverified >
// process_specific_template.
// ---------------------------------------------------------------------------
{
  const resolve = counts => resolveAgt002CompanyEvidenceEffectiveState({
    source_file_count: total(counts), state_counts: counts,
  });

  assert.equal(resolve(stateCounts()), 'absent_unknown', 'no source files at all must be an explicit documental gap');
  assert.equal(
    resolve(stateCounts({ absent_unknown: 3 })),
    'absent_unknown',
    'files known only as absent/unknown must never be promoted out of absent_unknown',
  );
  assert.equal(resolve(stateCounts({ current_valid: 1 })), 'current_valid');
  assert.equal(resolve(stateCounts({ historical_update_required: 1 })), 'historical_update_required');
  assert.equal(resolve(stateCounts({ reported_unverified: 1 })), 'reported_unverified');
  assert.equal(resolve(stateCounts({ process_specific_template: 1 })), 'process_specific_template');

  // Precedence, checked pairwise against every lower-ranked state.
  assert.equal(
    resolve(stateCounts({ current_valid: 1, historical_update_required: 9, reported_unverified: 9, process_specific_template: 9, absent_unknown: 9 })),
    'current_valid',
    'a single current_valid file outranks any number of lower-ranked ones',
  );
  assert.equal(
    resolve(stateCounts({ historical_update_required: 1, reported_unverified: 9, process_specific_template: 9, absent_unknown: 9 })),
    'historical_update_required',
    'historical evidence outranks merely reported evidence — it demonstrates capacity and raises an update alert',
  );
  assert.equal(
    resolve(stateCounts({ reported_unverified: 1, process_specific_template: 9, absent_unknown: 9 })),
    'reported_unverified',
  );
  assert.equal(
    resolve(stateCounts({ process_specific_template: 1, absent_unknown: 9 })),
    'process_specific_template',
    'a process-specific template is the weakest non-absent state, but still outranks absent_unknown',
  );
}

// ---------------------------------------------------------------------------
// Builder: exact safe shape, derived effective_state, catalog-ordered classes.
// ---------------------------------------------------------------------------
{
  const snapshot = buildBase();

  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['catalog_snapshot_hash', 'classes', 'excluded_non_evidence_count', 'inventory_version', 'source_file_count', 'state_counts'].sort(),
    'the snapshot must expose exactly the six safe top-level fields, no more',
  );
  assert.equal(snapshot.inventory_version, AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION);
  assert.match(snapshot.catalog_snapshot_hash, /^[0-9a-f]{64}$/, 'the catalog snapshot hash must be a 64-char lowercase sha256 digest');
  assert.equal(snapshot.source_file_count, 18);
  assert.equal(snapshot.excluded_non_evidence_count, 1);
  assert.deepEqual(Object.keys(snapshot.state_counts).sort(), [...AGT002_COMPANY_EVIDENCE_GOVERNED_STATES].sort(), 'state_counts must carry all five governed states, always');

  assert.equal(snapshot.classes.length, 17);
  assert.deepEqual(
    snapshot.classes.map(cls => cls.entry_id),
    [...AGT002_COMPANY_EVIDENCE_CLASS_IDS],
    'classes must be exactly the 17 closed catalog ids, in deterministic catalog order',
  );
  for (const cls of snapshot.classes) {
    assert.deepEqual(
      Object.keys(cls).sort(),
      ['effective_state', 'entry_id', 'last_reconciled_at', 'source_file_count', 'state_counts'].sort(),
      'a snapshot class must expose exactly the five safe fields — never an item id, name, path, URL, eTag or raw fingerprint',
    );
    assert.deepEqual(Object.keys(cls.state_counts).sort(), [...AGT002_COMPANY_EVIDENCE_GOVERNED_STATES].sort());
    assert.equal(cls.effective_state, 'reported_unverified');
    assert.ok(AGT002_COMPANY_EVIDENCE_GOVERNED_STATES.includes(cls.effective_state));
  }

  // Deeply frozen: a caller-held reference can never mutate a validated snapshot afterwards.
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.state_counts));
  assert.ok(Object.isFrozen(snapshot.classes));
  assert.ok(Object.isFrozen(snapshot.classes[0]));
  assert.ok(Object.isFrozen(snapshot.classes[0].state_counts));

  // Order independence: the same 17 classes supplied in any order build the same snapshot.
  const reversed = buildBase({ classes: [...baseClassInputs()].reverse() });
  assert.deepEqual(reversed, snapshot, 'class input order must never change the built snapshot');
}

// A class with zero source files is emitted as an explicit absent_unknown gap, never dropped.
{
  const snapshot = buildBase({
    classes: baseClassInputs({ rup: stateCounts() }),
    sourceFileCount: 17,
    stateCounts: stateCounts({ reported_unverified: 16 }),
  });
  const rup = snapshot.classes.find(cls => cls.entry_id === 'rup');
  assert.equal(rup.source_file_count, 0);
  assert.equal(rup.effective_state, 'absent_unknown');
  assert.equal(snapshot.classes.length, 17, 'a class with no linked source file must stay in the closed catalog, never disappear');
}

// ---------------------------------------------------------------------------
// Builder fail-closed: totals, counts, catalog membership, hash format.
// ---------------------------------------------------------------------------

// Global invariant: sum(state_counts) + excluded_non_evidence_count === source_file_count.
assert.throws(() => buildBase({ sourceFileCount: 19 }), /total|source_file_count|suma/i);
assert.throws(() => buildBase({ excludedNonEvidenceCount: 2 }), /total|excluded|suma/i);
assert.throws(() => buildBase({ stateCounts: stateCounts({ reported_unverified: 16 }) }), /total|state_counts|suma/i);

// Per-class invariant: sum(class.state_counts) === class.source_file_count.
assert.throws(
  () => buildBase({
    classes: baseClassInputs().map(cls => (cls.entry_id === 'rup' ? { ...cls, source_file_count: 5 } : cls)),
  }),
  /rup|total|source_file_count|suma/i,
  'a class whose counts do not add up to its own file count must fail closed, never be silently trusted',
);

// Exactly 17 unique, closed entry_ids.
assert.throws(() => buildBase({ classes: baseClassInputs().slice(1) }), /17|exactamente|falta/i);
assert.throws(
  () => buildBase({ classes: [...baseClassInputs().slice(1), classInput('rup', stateCounts({ reported_unverified: 1 }))] }),
  /duplicad|falta/i,
);
assert.throws(
  () => buildBase({ classes: [...baseClassInputs().slice(1), classInput('unknown_class', stateCounts({ reported_unverified: 1 }))] }),
  /catálogo|catalogo|entry_id/i,
);

// Counts must be real non-negative integers.
assert.throws(() => buildBase({ sourceFileCount: -1 }), /entero|integer|negativ|total|suma|source_file_count/i);
assert.throws(() => buildBase({ excludedNonEvidenceCount: 1.5 }), /entero|integer|negativ|total|suma|excluded/i);
assert.throws(
  () => buildBase({ classes: baseClassInputs({ rup: stateCounts({ reported_unverified: -1 }) }) }),
  /entero|integer|negativ|total|suma|rup/i,
);
assert.throws(
  () => buildBase({ classes: baseClassInputs().map(cls => (cls.entry_id === 'rup' ? { ...cls, state_counts: { reported_unverified: 1 } } : cls)) }),
  /state_counts|estado/i,
  'a class missing any of the five governed state keys must fail closed, never default to zero',
);

// Hash must be a 64-char LOWERCASE sha256 digest.
for (const badHash of [HASH.toUpperCase(), 'not-a-hash', `${HASH}0`, HASH.slice(1), null, 42]) {
  assert.throws(() => buildBase({ catalogSnapshotHash: badHash }), /hash/i, `${String(badHash)} must be rejected as a catalog snapshot hash`);
}

// last_reconciled_at is a real timestamp or an explicit null — never invented, never garbage.
assert.throws(
  () => buildBase({ classes: baseClassInputs().map(cls => (cls.entry_id === 'rup' ? { ...cls, last_reconciled_at: 'ayer' } : cls)) }),
  /last_reconciled_at|fecha/i,
);
{
  const snapshot = buildBase({
    classes: baseClassInputs().map(cls => (cls.entry_id === 'rup' ? { ...cls, last_reconciled_at: null } : cls)),
  });
  assert.equal(snapshot.classes.find(cls => cls.entry_id === 'rup').last_reconciled_at, null);
}

// ---------------------------------------------------------------------------
// Validator: re-validates a snapshot received from elsewhere (the RPC, a frozen job, a
// fixture) rather than trusting it verbatim, and returns a frozen normalized clone.
// ---------------------------------------------------------------------------
{
  const built = buildBase();
  const revalidated = validateAgt002CompanyEvidenceInventorySnapshot(JSON.parse(JSON.stringify(built)));
  assert.deepEqual(revalidated, built, 'a round-tripped snapshot must re-validate to exactly the same value');
  assert.ok(Object.isFrozen(revalidated));

  // Never the input object itself: a caller-held reference must not be able to mutate it later.
  const raw = JSON.parse(JSON.stringify(built));
  const validated = validateAgt002CompanyEvidenceInventorySnapshot(raw);
  raw.source_file_count = 999;
  assert.equal(validated.source_file_count, 18, 'the validator must return a clone, never the caller-held input');

  // Class order independence at validation time too.
  const shuffled = { ...JSON.parse(JSON.stringify(built)), classes: [...JSON.parse(JSON.stringify(built)).classes].reverse() };
  assert.deepEqual(validateAgt002CompanyEvidenceInventorySnapshot(shuffled), built, 'validation must normalize class order deterministically');

  const mutate = (patch) => ({ ...JSON.parse(JSON.stringify(built)), ...patch });

  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(null), /objeto|inventario/i);
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot([]), /objeto|inventario/i);
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(mutate({ inventory_version: 'agt002-company-evidence-sharepoint-catalog-v2' })), /inventory_version/i);
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(mutate({ extra_key: 1 })), /clave|key|exactamente/i);
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(mutate({ catalog_snapshot_hash: 'nope' })), /hash/i);
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(mutate({ source_file_count: 19 })), /total|source_file_count|suma/i);

  // A snapshot whose effective_state disagrees with its own counts is corrupted/hostile: the
  // validator re-derives the rule instead of trusting the value it was handed.
  const promoted = JSON.parse(JSON.stringify(built));
  promoted.classes.find(cls => cls.entry_id === 'rup').effective_state = 'current_valid';
  assert.throws(
    () => validateAgt002CompanyEvidenceInventorySnapshot(promoted),
    /effective_state|rup/i,
    'a snapshot claiming current_valid over reported_unverified counts must be rejected, never trusted',
  );

  // Extra per-class keys (an item id, a name, a path smuggled in) must be rejected outright.
  const widened = JSON.parse(JSON.stringify(built));
  widened.classes[0].item_id = '01PXSUBJ3FM4EW7U2H35BZF3IFBM2PTWRA';
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(widened), /clave|key|exactamente|item_id/i);

  const missingClass = JSON.parse(JSON.stringify(built));
  missingClass.classes = missingClass.classes.slice(1);
  assert.throws(() => validateAgt002CompanyEvidenceInventorySnapshot(missingClass), /17|exactamente|falta/i);
}

// ---------------------------------------------------------------------------
// Loader: exactly ONE RPC, fail-closed. A missing/erroring/malformed RPC must throw —
// never return an empty inventory, which would silently read as "this company has no
// evidence" and is precisely the failure this snapshot exists to make impossible.
// ---------------------------------------------------------------------------
function fakeDatabase({ data = null, error = null } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      return { data, error };
    },
    from() {
      throw new Error('the inventory snapshot loader must never read a detail table directly');
    },
  };
}

{
  const built = buildBase();
  const database = fakeDatabase({ data: JSON.parse(JSON.stringify(built)) });
  const loaded = await loadAgt002CompanyEvidenceInventorySnapshot(database);
  assert.equal(database.rpcCalls.length, 1, 'exactly one RPC round-trip per load — never a per-class fan-out');
  assert.equal(database.rpcCalls[0].name, AGT002_COMPANY_EVIDENCE_INVENTORY_RPC);
  assert.deepEqual(loaded, built, 'the loader must return the re-validated snapshot, verbatim');
  assert.ok(Object.isFrozen(loaded));
}

// A database error of ANY code fails closed — including the "function does not exist" codes
// that other optional-table loaders in this codebase deliberately fail SOFT on.
for (const code of ['PGRST202', '42883', 'PGRST205', '42P01', '53300']) {
  await assert.rejects(
    () => loadAgt002CompanyEvidenceInventorySnapshot(fakeDatabase({ error: { code, message: 'synthetic' } })),
    `error ${code} must fail closed, never degrade into an empty inventory`,
  );
}

// Absent/empty/malformed payloads all fail closed too.
for (const data of [null, undefined, {}, [], 'snapshot', { inventory_version: AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION }]) {
  await assert.rejects(
    () => loadAgt002CompanyEvidenceInventorySnapshot(fakeDatabase({ data })),
    `a ${JSON.stringify(data) ?? 'null'} RPC payload must fail closed`,
  );
}

// A payload that is well-formed but internally inconsistent must be rejected by the same
// validator the builder uses — the loader never has its own, weaker rules.
{
  const tampered = JSON.parse(JSON.stringify(buildBase()));
  tampered.classes.find(cls => cls.entry_id === 'rup').effective_state = 'current_valid';
  await assert.rejects(() => loadAgt002CompanyEvidenceInventorySnapshot(fakeDatabase({ data: tampered })));
}

// ---------------------------------------------------------------------------
// Nothing sensitive can ever ride along, whatever the caller passed in.
// ---------------------------------------------------------------------------
{
  const serialized = JSON.stringify(buildBase());
  for (const forbidden of [
    'item_id', 'name', 'path', 'url', 'etag', 'e_tag', 'fingerprint', 'drive', 'site',
    'sharepoint', 'https://', 'cédula', 'cedula', '.pdf', '.docx', '.zip',
  ]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `the safe snapshot must never carry "${forbidden}"`);
  }
}

console.log('AGT-002 governed SharePoint company-evidence catalog (inventory snapshot) contract passed');
