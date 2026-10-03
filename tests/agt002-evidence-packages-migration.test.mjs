// AGT-002 P0-02 evidence packages — migration 099 structural contract (RED, no production
// change). Mirrors the conventions of tests/agt002-governed-document-worksets-migration.test.mjs
// (Phase 2 of the governed document worksets plan), but pins a DISTINCT, neutral migration for
// the initial-analysis slice: supabase/migrations/099_agt002_evidence_packages.sql. Unlike 084,
// this migration must NEVER touch, reference, or enqueue into the reanalysis operational surface
// (psi_agt002_reanalysis_jobs and its four RPCs) anywhere in the file — the evidence package
// freeze is a neutral, job-free persistence operation.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/099_agt002_evidence_packages.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/099_agt002_evidence_packages_rollback.sql', import.meta.url);

const PACKAGE_TABLE = 'psi_agt002_evidence_packages';
const VERSION_TABLE = 'psi_agt002_evidence_package_versions';
const MEMBER_TABLE = 'psi_agt002_evidence_package_members';
const BATCH_TABLE = 'psi_agt002_evidence_package_batches';
const TABLES = [PACKAGE_TABLE, VERSION_TABLE, MEMBER_TABLE, BATCH_TABLE];

const RESOLVE_FN = 'psi_resolve_agt002_evidence_package_candidate';
const RESOLVE_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)`;
const FREEZE_FN = 'psi_freeze_agt002_evidence_package';
// (p_opportunity_id, p_tender_id, p_idempotency_key, p_members, p_package_hash,
// p_document_manifest_hash, p_semantic_manifest_hash, p_actor_profile_id) — deliberately never
// carries a snapshot_id/context_version_id/frozen_engine_input parameter: this freeze is neutral
// and never binds to (or produces) any reanalysis job identity.
const FREEZE_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*jsonb\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*uuid\s*\)`;
const NEW_RPCS = [
  [RESOLVE_FN, RESOLVE_ARGS],
  [FREEZE_FN, FREEZE_ARGS],
];

// Existing, untouched objects this migration must never redefine, drop, or reference.
const PREEXISTING_TO_PRESERVE = [
  'psi_record_tender_document_version',
  'psi_record_tender_document_extraction',
  'psi_resolve_agt002_governed_document_candidate',
  'psi_freeze_agt002_governed_document_workset',
  'psi_get_or_create_agt002_analysis_workset',
  'psi_finalize_agt002_durable_batched_analysis',
];
const PREEXISTING_TABLES_TO_PRESERVE = [
  'psi_tender_document_versions',
  'psi_tender_document_extractions',
  'psi_agt002_governed_document_worksets',
  'psi_agt002_analysis_worksets',
];

const REANALYSIS_TABLE_NAME = 'psi_agt002_reanalysis_jobs';
const REANALYSIS_RPC_NAMES = [
  'psi_create_agt002_reanalysis_job',
  'psi_claim_agt002_reanalysis_job',
  'psi_complete_agt002_reanalysis_job',
  'psi_fail_agt002_reanalysis_job',
];

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: AGT-002 P0-02 needs the next available additive migration 099_agt002_evidence_packages`,
  );
  return readFileSync(url, 'utf8');
}

function migrationSql() {
  return withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/099_agt002_evidence_packages.sql'));
}

function rollbackSql() {
  return withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/099_agt002_evidence_packages_rollback.sql'));
}

function tableBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+table\s+(if\s+not\s+exists\s+)?public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 099 must define public.${name}`);
  let depth = 0;
  let end = -1;
  for (let i = sql.indexOf('(', start); i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `public.${name} must be a complete, balanced table definition`);
  return sql.slice(start, end + 1);
}

function functionBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 099 must define public.${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `public.${name} must be a complete function body`);
  return sql.slice(start, end + 3);
}

function triggerBlockOn(sql, table) {
  const start = sql.search(new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+update\s+or\s+delete\s+on\s+public\.${table}\b`, 'i'));
  assert.notEqual(start, -1, `migration 099 must define an append-only trigger on public.${table}`);
  const end = sql.indexOf(';', start);
  assert.notEqual(end, -1, `the trigger on public.${table} must be a complete statement`);
  return sql.slice(start, end + 1);
}

function assertDefinerAndSearchPath(block, name) {
  assert.match(block, /security\s+definer/i, `public.${name} must be SECURITY DEFINER`);
  assert.match(block, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `public.${name} must pin its search_path`);
}

function privilegeRoles(sql, keyword, fn, args) {
  const preposition = keyword === 'grant' ? 'to' : 'from';
  const verb = keyword === 'grant' ? String.raw`grant\s+execute` : String.raw`revoke\s+all`;
  const pattern = new RegExp(String.raw`${verb}\s+on\s+function\s+public\.${fn}\s*${args}\s+${preposition}\s+([^;]+);`, 'gi');
  const roles = new Set();
  const indices = [];
  for (const match of sql.matchAll(pattern)) {
    indices.push(match.index);
    for (const role of match[1].split(',')) roles.add(role.trim().toLowerCase());
  }
  return { roles, indices };
}

function assertServiceRoleOnlyRpc(sql, name, args) {
  const revoked = privilegeRoles(sql, 'revoke', name, args);
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.ok(revoked.roles.has(role), `public.${name} must revoke all from ${role} before granting anything`);
  }
  const granted = privilegeRoles(sql, 'grant', name, args);
  assert.deepEqual([...granted.roles].sort(), ['service_role'], `public.${name} must grant execute to service_role only`);
  assert.ok(granted.indices.length > 0, `public.${name} must grant execute to service_role`);
  assert.ok(
    Math.max(...revoked.indices) < Math.min(...granted.indices),
    `public.${name} must revoke first and grant afterwards`,
  );
}

test('migration 099 exists, is one transaction, and stays additive beside every preexisting AGT-002/document object', () => {
  const migration = migrationSql();
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');
  assert.doesNotMatch(migration, /drop\s+table/i, 'migration 099 must never drop an existing table');
  assert.doesNotMatch(migration, /alter\s+table[^;]*drop\s+column/i, 'migration 099 must never drop an existing column');

  for (const fn of PREEXISTING_TO_PRESERVE) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\b`, 'i'),
      `migration 099 must never redefine the preexisting public.${fn}`,
    );
  }
});

test('migration 099 never references the reanalysis operational surface — the evidence package is neutral and job-free', () => {
  const migration = migrationSql();
  assert.doesNotMatch(
    migration, new RegExp(REANALYSIS_TABLE_NAME, 'i'),
    'migration 099 must never reference psi_agt002_reanalysis_jobs anywhere: freezing an evidence package must create zero reanalysis jobs',
  );
  for (const rpc of REANALYSIS_RPC_NAMES) {
    assert.doesNotMatch(
      migration, new RegExp(rpc, 'i'),
      `migration 099 must never call or reference ${rpc}: freezing an evidence package must create zero reanalysis jobs`,
    );
  }
});

test('every new table is additive: RLS on, revoked from every direct role, service_role read-only', () => {
  const migration = migrationSql();
  for (const table of TABLES) {
    tableBlock(migration, table);
    assert.match(
      migration, new RegExp(String.raw`alter\s+table\s+public\.${table}\s+enable\s+row\s+level\s+security`, 'i'),
      `public.${table} must enable row level security`,
    );
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      assert.match(
        migration,
        new RegExp(String.raw`revoke\s+all\s+on\s+table\s+public\.${table}\s+from\s+[^;]*\b${role}\b`, 'i'),
        `public.${table} must revoke all from ${role} before any narrower grant`,
      );
    }
    assert.match(
      migration, new RegExp(String.raw`grant\s+select\s+on\s+table\s+public\.${table}\s+to\s+service_role`, 'i'),
      `public.${table} must grant service_role read-only access`,
    );
  }
});

test('every new table is permanently append-only: no UPDATE or DELETE survives for any role', () => {
  const migration = migrationSql();
  for (const table of TABLES) {
    const trigger = triggerBlockOn(migration, table);
    const fnNameMatch = trigger.match(/execute\s+function\s+public\.(\S+)\s*\(/i);
    assert.ok(fnNameMatch, `the append-only trigger on public.${table} must name its enforcement function`);
    const fn = functionBlock(migration, fnNameMatch[1]);
    assert.match(fn, /raise\s+exception/i, `public.${fnNameMatch[1]} must unconditionally reject the mutation`);
  }
});

test('psi_agt002_evidence_packages: one header row per exact (opportunity, tender) identity', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, PACKAGE_TABLE);
  assert.match(block, /opportunity_id\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_opportunities/i);
  assert.match(block, /tender_id\s+uuid\s+not\s+null\s+references\s+public\.psi_public_tenders/i);
  assert.match(
    block, /unique\s*\(\s*opportunity_id\s*,\s*tender_id\s*\)/i,
    'the package identity is exactly (opportunity_id, tender_id): every version for a tender hangs off this one header row',
  );
});

test('psi_agt002_evidence_package_versions: three deterministic 64-hex digests, a monotonic version_number, and an idempotency_key', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, VERSION_TABLE);
  assert.match(block, new RegExp(String.raw`package_id\s+uuid\s+not\s+null\s+references\s+public\.${PACKAGE_TABLE}`, 'i'));
  assert.match(block, /version_number\s+integer\s+not\s+null[^,]*check\s*\([^)]*version_number\s*>=?\s*1[^)]*\)/is, 'version_number must start at 1 and only ever increase');
  assert.match(
    block, /idempotency_key\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*idempotency_key\s*\)/is,
    'the frozen version must carry a non-blank idempotency_key, so a client replay is provably the same request',
  );
  for (const column of ['package_hash', 'document_manifest_hash', 'semantic_manifest_hash']) {
    assert.match(
      block, new RegExp(String.raw`${column}\s+text\s+not\s+null[^,]*check\s*\([^)]*${column}\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)`, 'is'),
      `${column} must be a validated SHA-256 hex digest, matching computeAgt002EvidencePackageHash()/computeAgt002EvidencePackage*ManifestHash()'s output`,
    );
  }
  assert.match(block, /member_count\s+integer\s+not\s+null[^,]*check\s*\([^)]*member_count\s*>=?\s*1[^)]*\)/is, 'member_count must be bounded at the low end: a version always has at least one member');
  assert.match(block, /batch_count\s+integer\s+not\s+null[^,]*check\s*\([^)]*batch_count\s*>=?\s*1[^)]*\)/is, 'batch_count must be bounded at the low end: a version always has at least one batch');
  assert.match(block, /created_by\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_profiles/i, 'the freezing actor must reference a real profile, never a free-text/anonymous field');
  assert.match(
    block, new RegExp(String.raw`unique\s*\(\s*package_id\s*,\s*version_number\s*\)`, 'i'),
    'version_number must be unique per package',
  );
  assert.match(
    block, new RegExp(String.raw`unique\s*\(\s*package_id\s*,\s*package_hash\s*\)`, 'i'),
    'an exact-content replay under the same package identity reuses the same version row',
  );
});

test('psi_agt002_evidence_package_members: frozen evidence mirrors freezeAgt002EvidencePackageEvidence()\'s output shape exactly, and no functional per-package member ceiling appears anywhere', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, MEMBER_TABLE);
  assert.match(block, new RegExp(String.raw`package_version_id\s+uuid\s+not\s+null\s+references\s+public\.${VERSION_TABLE}`, 'i'));
  assert.match(
    block, /document_version_id\s+uuid\s+not\s+null\s+references\s+public\.psi_tender_document_versions/i,
    'every member must reference a real, existing document version row — the same neutral document identity register the governed workset (026) reuses',
  );
  assert.match(block, /batch_index\s+integer\s+not\s+null[^,]*check\s*\([^)]*batch_index\s*>=?\s*0[^)]*\)/is, 'batch_index must be recorded on every member row');

  const classificationMatch = block.match(/source_classification\s+text\s+not\s+null[^,]*check\s*\(\s*source_classification\s+in\s*\(([^)]+)\)\s*\)/is);
  assert.ok(classificationMatch, 'source_classification must be a closed check constraint');
  const classifications = classificationMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(
    classifications.sort(),
    ['corporate', 'draft', 'internal', 'official', 'third_party'],
    'source_classification must be exactly AGT002_EVIDENCE_PACKAGE_SOURCE_CLASSIFICATIONS, no more, no fewer',
  );

  assert.match(
    block, /inclusion_reason\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*inclusion_reason\s*\)/is,
    'inclusion_reason must be required and non-blank, matching normalizeRequestedAgt002EvidencePackageMembers()',
  );
  assert.match(block, /inclusion_reason[\s\S]{0,200}<=\s*500/i, 'inclusion_reason must be bounded at 500 characters');

  assert.match(block, /content_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*content_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is);
  assert.match(block, /extraction_id\s+uuid\s+not\s+null\s+references\s+public\.psi_tender_document_extractions/i);
  assert.match(block, /extraction_text_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*extraction_text_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is);

  assert.match(
    block, /unique\s*\(\s*package_version_id\s*,\s*document_version_id\s*\)/i,
    'every mandatory eligible member must appear at most once per frozen version',
  );

  assert.doesNotMatch(
    block, /\bextracted_text\b|\bstorage_path\b|\bsource_url\b|\bsigned_url\b/i,
    'a frozen member row must never carry raw extracted text or storage/source locators',
  );

  // The defining contract difference from the governed workset's members table (084): NO
  // upper-bound check constraint on any per-package/per-version total exists here at all — the
  // only numeric ceiling in this whole migration is the per-BATCH cap enforced on the batches
  // table below.
  assert.doesNotMatch(
    block, /<=\s*12/,
    'psi_agt002_evidence_package_members must carry no upper member-count bound of its own: the package has no functional member limit',
  );
});

test('psi_agt002_evidence_package_batches: every batch is capped at 12 members — the ONLY numeric ceiling in this migration', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, BATCH_TABLE);
  assert.match(block, new RegExp(String.raw`package_version_id\s+uuid\s+not\s+null\s+references\s+public\.${VERSION_TABLE}`, 'i'));
  assert.match(block, /batch_index\s+integer\s+not\s+null[^,]*check\s*\([^)]*batch_index\s*>=?\s*0[^)]*\)/is);
  assert.match(
    block, /member_count\s+integer\s+not\s+null[^,]*check\s*\([^)]*member_count\s*>=?\s*1[^)]*\)/is,
    'member_count must be bounded at the low end (1)',
  );
  assert.match(
    block, /member_count[\s\S]{0,80}<=\s*12/i,
    'member_count must be bounded at the high end: no single batch may exceed 12 members (AGT002_EVIDENCE_PACKAGE_BATCH_SIZE)',
  );
  assert.match(
    block, /unique\s*\(\s*package_version_id\s*,\s*batch_index\s*\)/i,
    'batch_index must be unique per frozen version',
  );
});

test('every new RPC is SECURITY DEFINER, search_path-pinned, and service_role only', () => {
  const migration = migrationSql();
  for (const [fn, args] of NEW_RPCS) {
    const block = functionBlock(migration, fn);
    assertDefinerAndSearchPath(block, fn);
    assertServiceRoleOnlyRpc(migration, fn, args);
  }
});

test('psi_resolve_agt002_evidence_package_candidate reuses the real neutral document identity/extraction registers and enforces scope', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RESOLVE_FN);
  assert.match(block, /from\s+public\.psi_tender_document_versions/i, 'resolution must read the real document version register, never a client-supplied hash');
  assert.match(block, /psi_tender_document_extractions/i, 'resolution must read the real typed extraction register for extraction_id/status/text_hash');
  assert.match(block, /raise\s+exception/i, 'a document_version_id that belongs to a different opportunity/tender must fail closed');
});

test('psi_freeze_agt002_evidence_package: only an active, Licitaciones-authorized actor may freeze (RBAC fail-closed)', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(block, /psi_profile_permissions/i, 'the freeze RPC must check public.psi_profile_permissions, the real module-authorization table (021)');
  assert.match(block, /'licitaciones'/i, 'the freeze RPC must require the exact "licitaciones" permission code');
  assert.match(block, /active\s*(=|is)\s*true|active\s+is\s+distinct\s+from\s+true/i, 'a deactivated actor must fail closed even while their permission row still exists');
  assert.match(block, /raise\s+exception/i, 'an unauthorized or inactive actor must fail closed');
});

test('psi_freeze_agt002_evidence_package: fail-closed re-verification of every member against live evidence (tenant/tender/opportunity scope)', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, /current\s*(=|is)\s*true|current\s+is\s+distinct\s+from\s+true/i,
    'the freeze RPC must re-verify each member\'s document version is current — a stale version must reject the whole package',
  );
  assert.match(
    block, /status\s*(=|is)\s*'ok'|status\s+is\s+distinct\s+from\s+'ok'/i,
    'the freeze RPC must re-verify each member\'s extraction status is ok before trusting its hash',
  );
  assert.match(
    block, /content_hash[\s\S]{0,200}(is\s+distinct\s+from|<>|!=)/i,
    'the freeze RPC must re-verify the submitted content_hash against the live psi_tender_document_versions row',
  );
  assert.match(
    block, /extraction_text_hash[\s\S]{0,200}(is\s+distinct\s+from|<>|!=)|text_hash[\s\S]{0,200}(is\s+distinct\s+from|<>|!=)/i,
    'the freeze RPC must re-verify the submitted extraction_text_hash against the live psi_tender_document_extractions row',
  );
  assert.match(block, /raise\s+exception/i, 'any mismatch must fail closed: no partial package is ever persisted');
});

test('psi_freeze_agt002_evidence_package: no functional upper bound on jsonb_array_length(p_members) — only the governed workset (084) bounds its total member count', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.doesNotMatch(
    block, /jsonb_array_length\s*\(\s*p_members\s*\)\s*>\s*12/i,
    'psi_freeze_agt002_evidence_package must never reject a package purely for exceeding 12 total members: only individual batches are capped at 12',
  );
});

test('psi_freeze_agt002_evidence_package: idempotent reuse for the same (package_id, package_hash) identity when idempotency_key also matches, fail-closed on any mismatch', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, new RegExp(String.raw`select[\s\S]{0,400}from\s+public\.${VERSION_TABLE}`, 'i'),
    'the freeze RPC must look up an existing version under the same package identity before inserting',
  );
  assert.match(
    block, /idempotency_key\s+is\s+distinct\s+from|idempotency_key\s*(<>|!=)/i,
    'a replay under the same package_hash but a different idempotency_key must fail closed',
  );
  assert.match(block, /raise\s+exception/i, 'a conflicting replay must fail closed, never silently pick one side');
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${VERSION_TABLE}`, 'i'),
    'a genuinely new identity must insert a new version row',
  );
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${MEMBER_TABLE}`, 'i'),
    'freezing must insert every member row',
  );
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${BATCH_TABLE}`, 'i'),
    'freezing must insert every batch row',
  );
});

test('psi_freeze_agt002_evidence_package: an addendum (a new package_hash under the SAME package_id) computes the next version_number, never touching or renumbering any prior version', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, /coalesce\s*\(\s*max\s*\(\s*version_number\s*\)\s*,\s*0\s*\)\s*\+\s*1|max\s*\(\s*version_number\s*\)[\s\S]{0,40}\+\s*1/i,
    'the next version_number must be computed as the current max plus one, scoped to this package_id',
  );
  assert.doesNotMatch(
    block, new RegExp(String.raw`update\s+public\.${VERSION_TABLE}`, 'i'),
    'the freeze RPC must never UPDATE an existing version row: an addendum always inserts a brand-new version, leaving every prior frozen version byte-for-byte unchanged',
  );
});

test('psi_freeze_agt002_evidence_package: freeze and batch-partition happen atomically, in the same function body, and never enqueue anything', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.doesNotMatch(
    block, /exception\s+when\s+others\s+then/i,
    'the freeze RPC must never catch-and-continue past a validation or insert failure: the whole transaction must roll back',
  );
  assert.doesNotMatch(block, new RegExp(REANALYSIS_TABLE_NAME, 'i'), 'the freeze RPC must never touch the reanalysis jobs table: freezing creates zero reanalysis jobs');
  for (const rpc of REANALYSIS_RPC_NAMES) {
    assert.doesNotMatch(block, new RegExp(rpc, 'i'), `the freeze RPC must never call ${rpc}: freezing creates zero reanalysis jobs`);
  }
});

test('no new RPC accepts a raw prompt, extracted text, storage path, or credential as a parameter', () => {
  const migration = migrationSql();
  for (const [fn] of NEW_RPCS) {
    const block = functionBlock(migration, fn);
    const signature = block.slice(0, block.indexOf(')') + 1);
    assert.doesNotMatch(
      signature, /p_(prompt|raw[a-z_]*|extracted_text|storage_path|source_url|signed_url|credential|api_key|secret)\b/i,
      `public.${fn} must never accept a raw prompt/extracted-text/storage-path/credential parameter`,
    );
  }
});

test('the rollback exists, is one transaction, and fails closed while any package/version/member/batch history exists', () => {
  const rollback = rollbackSql();
  assert.match(rollback, /^\s*begin;/im, 'the rollback must run inside one transaction');
  assert.match(rollback, /^\s*commit;/im, 'the rollback must commit its single transaction');
  assert.match(
    rollback, /raise\s+exception/i,
    'the rollback must fail closed while frozen packages/versions/members/batches still exist',
  );
  for (const table of TABLES) {
    assert.match(
      rollback, new RegExp(String.raw`select\s+1\s+from\s+public\.${table}|exists\s*\(\s*select[^)]*public\.${table}`, 'is'),
      `the rollback guard must check for existing rows in public.${table} before dropping anything`,
    );
  }

  for (const [fn, args] of NEW_RPCS) {
    assert.match(
      rollback, new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${fn}\s*${args}\s*;`, 'i'),
      `the rollback must drop public.${fn} by its exact signature`,
    );
  }
  for (const table of TABLES) {
    assert.match(
      rollback, new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${table}\b`, 'i'),
      `the rollback must remove public.${table}`,
    );
  }

  // Dependency order: members and batches reference versions, which reference packages.
  const versionsDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${VERSION_TABLE}\b`, 'i'));
  const packagesDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${PACKAGE_TABLE}\b`, 'i'));
  for (const dependent of [MEMBER_TABLE, BATCH_TABLE]) {
    const dependentDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${dependent}\b`, 'i'));
    assert.ok(dependentDropIdx !== -1 && dependentDropIdx < versionsDropIdx, `the rollback must drop public.${dependent} before public.${VERSION_TABLE}`);
  }
  assert.ok(versionsDropIdx !== -1 && versionsDropIdx < packagesDropIdx, `the rollback must drop public.${VERSION_TABLE} before public.${PACKAGE_TABLE}`);

  for (const fn of PREEXISTING_TO_PRESERVE) {
    assert.doesNotMatch(
      rollback, new RegExp(String.raw`drop\s+function\s+(if\s+exists\s+)?public\.${fn}\b`, 'i'),
      `the rollback must never remove the preexisting public.${fn}`,
    );
  }
  for (const table of PREEXISTING_TABLES_TO_PRESERVE) {
    assert.doesNotMatch(
      rollback, new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${table}\b`, 'i'),
      `the rollback must never drop the preexisting public.${table}`,
    );
  }
});

console.log('AGT-002 evidence packages migration 099 static structural contract passed');
