import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createReadOnlyClientGuard,
  assertExactClosedCurrentClasses,
  assertSanitaryReconcileMetadataOnly,
  buildSanitaryReconcileSummary,
  loadEnvFile,
  parseArgs,
  renderMarkdown,
  runProductionReconcile,
  AGT002_PRE_GO_RECONCILE_ARTIFACT_TYPE,
  AGT002_EXPECTED_EVIDENCE_CLASS_COUNT,
} from '../scripts/agt002-manizales-pre-go-production-reconcile.mjs';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { computeAgt002LegalManifestContentHash } from '../scripts/validate_agt002_legal_corpus.mjs';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_AT = '2026-08-12T00:00:00.000Z';

// --- Fake, in-memory, production-free Supabase-like client --------------------------------
// Mirrors ONLY the read surface the two allowlisted loaders use: .from(t).select().eq().order()
// awaited to { data, error }. It never contacts production. Write verbs are absent so the
// read-only guard has something to intercept.
function fakeBuilder(rows) {
  const builder = {
    _rows: rows,
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    then(resolve) { resolve({ data: builder._rows, error: null }); },
  };
  return builder;
}

function fakeRegistryRows() {
  // 17 closed classes, all reported / pending_human_review / pending_case_validation (as in
  // production): 2 with a future expiry (current), 15 unknown; 5 without an accessible hash.
  return AGT002_COMPANY_EVIDENCE_CLASS_IDS.map((entryId, index) => ({
    entry_id: entryId,
    document_class: `Clase ${index + 1}`,
    existence_status: 'reported',
    human_review_status: 'pending_human_review',
    applicability_status: 'pending_case_validation',
    source_reference: null,
    human_gate: null,
    hash: index < 12 ? `hash-${index}` : null,
    expiry: index < 2 ? '2030-01-01' : null,
    current: true,
    integration_active: true,
    updated_at: '2026-08-01T00:00:00Z',
    created_at: '2026-07-01T00:00:00Z',
  }));
}

function fakeLegalDataset() {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'data/agt002/legal-corpus-v1.1.json'), 'utf8'));
  const hash = computeAgt002LegalManifestContentHash(manifest);
  const versionId = '11111111-1111-4111-8111-111111111111';
  const SOURCE_FIELDS = ['source_id', 'norm_type', 'norm_number', 'year', 'article_or_section', 'current_text',
    'issuing_authority', 'issued_at', 'effective_from', 'effective_to', 'modifications', 'official_url',
    'topic', 'sector', 'verified_at', 'verification_status', 'validity_status', 'applicability_status'];
  const versionRow = {
    id: versionId, corpus_version: manifest.corpus_version, status: 'published',
    content_sha256: hash, published_at: '2026-08-01T00:00:00Z', published_by: 'human-actor',
  };
  const sourceRows = manifest.sources.map((source) => {
    const row = { corpus_version_id: versionId };
    for (const field of SOURCE_FIELDS) if (field in source) row[field] = source[field];
    return row;
  });
  return { versionRow, sourceRows, hash, corpusVersion: manifest.corpus_version, sourceCount: manifest.sources.length };
}

function makeFakeClient({ registryRows, legal }) {
  const writes = [];
  return {
    from(table) {
      if (table === 'psi_agt002_company_evidence_registry') return fakeBuilder(registryRows);
      if (table === 'psi_agt002_legal_corpus_versions') return fakeBuilder([legal.versionRow]);
      if (table === 'psi_agt002_legal_sources') return fakeBuilder(legal.sourceRows);
      throw new Error(`tabla inesperada en el fake: ${table}`);
    },
    // Present so we can prove the guard intercepts writes rather than the method just missing.
    insert() { writes.push('insert'); return fakeBuilder([]); },
    update() { writes.push('update'); return fakeBuilder([]); },
    rpc() { writes.push('rpc'); return Promise.resolve({ data: null, error: null }); },
    _writes: writes,
  };
}

// --- Read-only guard ----------------------------------------------------------------------
test('read-only guard throws on every write verb, at client and builder level', () => {
  const client = makeFakeClient({ registryRows: fakeRegistryRows(), legal: fakeLegalDataset() });
  const guarded = createReadOnlyClientGuard(client);
  for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.throws(() => guarded[verb](), /READ-ONLY|prohibido/, `guarded.${verb} debe lanzar`);
  }
  assert.throws(() => guarded.from('psi_agt002_company_evidence_registry').insert({}), /READ-ONLY|prohibido/);
  assert.throws(() => guarded.storage(), /READ-ONLY|prohibido/);
  assert.equal(client._writes.length, 0, 'ninguna escritura debe haber tocado el cliente subyacente');
});

test('read-only guard still allows the loader read chain', async () => {
  const guarded = createReadOnlyClientGuard(makeFakeClient({ registryRows: fakeRegistryRows(), legal: fakeLegalDataset() }));
  const { data, error } = await guarded.from('psi_agt002_company_evidence_registry').select('entry_id').eq('current', true).order('entry_id');
  assert.equal(error, null);
  assert.equal(data.length, 17);
});

test('read-only guard re-wraps immutable query builders returned by read methods', () => {
  const writes = [];
  const immutableBuilder = () => ({
    select() { return immutableBuilder(); },
    insert() { writes.push('insert'); },
    then(resolve) { resolve({ data: [], error: null }); },
  });
  const guarded = createReadOnlyClientGuard({ from() { return immutableBuilder(); } });
  const selected = guarded.from('psi_agt002_company_evidence_registry').select('entry_id');
  assert.throws(() => selected.insert({}), /READ-ONLY|prohibido/);
  assert.equal(writes.length, 0, 'el builder nuevo tampoco debe alcanzar una escritura subyacente');
});

// --- Closed-class exigency ----------------------------------------------------------------
test('assertExactClosedCurrentClasses requires exactly 17 unique closed-catalog ids', () => {
  const ok = assertExactClosedCurrentClasses(fakeRegistryRows());
  assert.equal(ok.length, AGT002_EXPECTED_EVIDENCE_CLASS_COUNT);
  assert.deepEqual(ok, [...ok].sort());

  assert.throws(() => assertExactClosedCurrentClasses(fakeRegistryRows().slice(0, 16)), /exactamente 17/);
  const dup = fakeRegistryRows(); dup[1] = { ...dup[0] };
  assert.throws(() => assertExactClosedCurrentClasses(dup), /duplicad/);
  const outside = fakeRegistryRows(); outside[0] = { ...outside[0], entry_id: 'no_existe_en_catalogo' };
  assert.throws(() => assertExactClosedCurrentClasses(outside), /fuera del catálogo/);
});

// --- Sanitary metadata-only guard ---------------------------------------------------------
test('assertSanitaryReconcileMetadataOnly rejects forbidden keys, substrings and long strings', () => {
  assert.doesNotThrow(() => assertSanitaryReconcileMetadataOnly({ a: 'reported', n: 17, ids: ['rup', 'rce_policy'] }));
  assert.throws(() => assertSanitaryReconcileMetadataOnly({ source_reference: 'x' }), /clave prohibida/);
  assert.throws(() => assertSanitaryReconcileMetadataOnly({ x: 'https://tenant.sharepoint.com/doc' }), /subcadena prohibida/);
  assert.throws(() => assertSanitaryReconcileMetadataOnly({ x: 'valor con https://host' }), /subcadena prohibida/);
  assert.throws(() => assertSanitaryReconcileMetadataOnly({ x: '/root/psi-comercial/.env.local' }), /subcadena prohibida/);
  assert.throws(() => assertSanitaryReconcileMetadataOnly({ x: 'a'.repeat(600) }), /demasiado larga/);
});

// --- env / args ---------------------------------------------------------------------------
test('loadEnvFile does not override existing env and parses key=value without printing', () => {
  const key = 'AGT002_RECONCILE_TEST_ONLY';
  delete process.env[key];
  const tmp = resolve(ROOT, 'tests/.tmp-agt002-reconcile.env');
  process.env.AGT002_RECONCILE_PRESET = 'ya_existe';
  writeFileSync(tmp, `# comment\n${key}=valor_local\nSHOULD_IGNORE\nAGT002_RECONCILE_PRESET=nuevo\n`);
  try {
    loadEnvFile(tmp);
    assert.equal(process.env[key], 'valor_local');
    assert.equal(process.env.AGT002_RECONCILE_PRESET, 'ya_existe');
  } finally {
    rmSync(tmp, { force: true });
    delete process.env[key];
    delete process.env.AGT002_RECONCILE_PRESET;
  }
});

test('parseArgs reads --env-file, --write and --generated-at, rejecting unknown flags', () => {
  const parsed = parseArgs(['--env-file', '/tmp/x.env', '--write', '--generated-at', GENERATED_AT]);
  assert.equal(parsed.write, true);
  assert.equal(parsed.generatedAt, GENERATED_AT);
  assert.match(parsed.envPath, /x\.env$/);
  assert.throws(() => parseArgs(['--nope']), /no soportado/);
});

// --- Integration: full reconcile against the fake client ----------------------------------
test('runProductionReconcile produces an honest, sanitary metadata-only summary', async () => {
  const legal = fakeLegalDataset();
  const database = makeFakeClient({ registryRows: fakeRegistryRows(), legal });
  const { summary } = await runProductionReconcile({ database, generatedAt: GENERATED_AT });

  assert.equal(summary.artifact_type, AGT002_PRE_GO_RECONCILE_ARTIFACT_TYPE);
  assert.equal(summary.read_only, true);
  assert.equal(summary.metadata_only, true);
  assert.equal(summary.human_approval_required, true);

  // 17 closed classes, honest breakdowns (2 current / 15 unknown vigencias, 5 inaccessible).
  const re = summary.registry_evidence;
  assert.equal(re.entries_observed, 17);
  assert.deepEqual(re.presence_breakdown, { verified: 0, reported: 17, not_verified: 0 });
  assert.deepEqual(re.review_breakdown, { pending_human_review: 17, approved: 0, rejected: 0 });
  assert.deepEqual(re.validity_breakdown, { current: 2, expired: 0, unknown: 15 });
  assert.deepEqual(re.applicability_breakdown, { pending_case_validation: 17, applicable: 0, not_applicable: 0 });
  assert.equal(re.coverage_counts.inaccessible, 5);
  assert.equal(re.coverage_counts.pending_review, 17);

  // Legal verification: shown ONLY from a validated published version, hash + source count only.
  assert.equal(summary.legal_verification.shown, true);
  assert.equal(summary.legal_verification.corpus_version, legal.corpusVersion);
  assert.equal(summary.legal_verification.content_sha256, legal.hash);
  assert.equal(summary.legal_verification.source_count, legal.sourceCount);
  assert.equal('current_text' in summary.legal_verification, false);

  // Honest replacement: with real classes the vault-not-observable blocker is gone; 17 reported
  // become human_review_required, NEVER satisfied/missing/cumplido.
  const hr = summary.honest_replacement;
  assert.equal(hr.vault_not_observable_blocker_present, false);
  assert.equal(hr.sections_satisfied_candidate, 0);
  assert.equal(hr.sections_missing, 0);
  assert.equal(hr.sections_stale, 0);
  assert.equal(hr.sections_human_review_required, 5);
  assert.equal(hr.sections_unverifiable, 10);
  assert.deepEqual(hr.unmapped_offer_sections, []);
  assert.deepEqual(hr.proposed_offer_sections, ['2.3', '2.4', '2.4.1', '2.5', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6'].sort());
  assert.equal(summary.section_proposal_overlay.applied, true);
  assert.equal(summary.section_proposal_overlay.status, 'proposed_for_human_review');
  assert.equal(summary.section_proposal_overlay.is_approved, false);
  assert.equal(summary.section_proposal_overlay.requirement_count, 20);
  assert.equal(summary.section_proposal_overlay.with_candidate_evidence_class, 9);
  assert.equal(summary.section_proposal_overlay.without_candidate_evidence_class, 11);
  assert.deepEqual(hr.cctv_abstention_refs, ['2.1']);

  // Ten offer sections now carry LOCAL proposals pending human review; none is approved/satisfied.
  assert.ok(!summary.blockers.some(b => b.id === 'secciones_relevantes_sin_requisito_gobernado'));
  assert.ok(summary.blockers.some(b => b.id === 'secciones_con_propuesta_de_requisitos_para_revision_humana'));
  assert.ok(summary.blockers.some(b => b.id === 'requisito_gobernado_sin_enlace_de_clase'));
  assert.ok(!summary.blockers.some(b => b.id === 'evidencia_empresarial_no_observable_localmente'));
  assert.ok(!summary.blockers.some(b => b.id === 'verificacion_juridica_no_disponible_sin_corpus'));

  // Recommendation stays candidate-only; human GO/NO-GO mandatory.
  assert.equal(summary.recommendation.recommendation_candidate, 'indeterminate');
  assert.equal(summary.recommendation.human_go_no_go_required, true);

  // Output is sanitary metadata-only and PII-free (already asserted inside run, re-checked here).
  assert.doesNotThrow(() => assertNoOpenPii(summary));
  assert.doesNotThrow(() => assertSanitaryReconcileMetadataOnly(summary));

  // The rendered markdown is derived purely from the sanitary summary and leaks no
  // SharePoint reference, URL, secret path or credential.
  const markdown = renderMarkdown(summary);
  assert.match(markdown, /# Reconciliación pre-GO PRODUCTIVA/);
  assert.ok(!markdown.endsWith('\n'), 'renderMarkdown no agrega un salto extra; el escritor añade exactamente uno');
  for (const needle of ['sharepoint', '://', '.env', 'service_role', 'bearer ', '/root/']) {
    assert.ok(!markdown.toLowerCase().includes(needle), `el markdown no debe contener "${needle}"`);
  }
});

test('runProductionReconcile fails closed if production does not present exactly 17 classes', async () => {
  const legal = fakeLegalDataset();
  const database = makeFakeClient({ registryRows: fakeRegistryRows().slice(0, 16), legal });
  await assert.rejects(runProductionReconcile({ database, generatedAt: GENERATED_AT }), /exactamente 17/);
});

console.log('agt002-manizales-pre-go-production-reconcile.test.mjs OK');
