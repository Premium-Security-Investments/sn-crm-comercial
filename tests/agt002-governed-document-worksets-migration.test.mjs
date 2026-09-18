// AGT-002 governed document worksets — migration 084 structural contract (RED, no
// production change).
//
// Pins the SQL half of Phase 2 of .hermes/plans/2026-09-17-agt002-governed-document-worksets.md
// ("Additive secure schema / RLS / RPCs"): the next available additive migration,
// supabase/migrations/084_agt002_governed_document_worksets.sql, plus its rollback. Phase 1
// (agt002-governed-document-worksets.js, already implemented and covered by
// tests/agt002-governed-document-worksets.test.mjs) is the source of truth for field names and
// closed vocabularies this migration must mirror exactly: the five source_classification values
// (AGT002_WORKSET_SOURCE_CLASSIFICATIONS), the 1..12 member bound (MIN/MAX_MEMBERS), the
// <=500-char inclusion_reason bound, and the three frozen evidence fields per member
// (content_hash, extraction_id, extraction_text_hash) resolved from the existing
// psi_tender_document_versions / psi_tender_document_extractions registers (026/065) — never
// trusted from the client, per the plan's "Server-side resolution" and "Immutable freeze"
// decisions.
//
// Neither file exists yet — reported as an ordinary failed assertion (assert.ok(existsSync...))
// rather than an unreadable-file crash. Assertions target security/identity semantics (definer +
// pinned search_path, revoke-then-grant to service_role only, Licitaciones-only authorization,
// append-only immutability, fail-closed hash/scope/staleness re-verification, atomic
// freeze-and-enqueue, idempotent-but-conflict-fails-closed replay) — not formatting.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/084_agt002_governed_document_worksets.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/084_agt002_governed_document_worksets_rollback.sql', import.meta.url);

const WORKSET_TABLE = 'psi_agt002_governed_document_worksets';
const MEMBER_TABLE = 'psi_agt002_governed_document_workset_members';
const RUN_TABLE = 'psi_agt002_governed_document_workset_runs';
const TABLES = [WORKSET_TABLE, MEMBER_TABLE, RUN_TABLE];

const RESOLVE_FN = 'psi_resolve_agt002_governed_document_candidate';
const RESOLVE_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)`;
const FREEZE_FN = 'psi_freeze_agt002_governed_document_workset';
// (p_opportunity_id, p_tender_id, p_snapshot_id, p_context_version_id, p_idempotency_key,
// p_members, p_frozen_engine_input, p_actor_profile_id) — the freeze RPC now binds and
// enqueues the exact identity psi_create_agt002_reanalysis_job (068) requires.
const FREEZE_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*uuid\s*\)`;
const NEW_RPCS = [
  [RESOLVE_FN, RESOLVE_ARGS],
  [FREEZE_FN, FREEZE_ARGS],
];

// Existing, untouched objects this migration must never redefine or drop.
const PREEXISTING_TO_PRESERVE = [
  'psi_record_tender_document_version',
  'psi_record_tender_document_extraction',
  'psi_get_or_create_agt002_analysis_workset',
  'psi_finalize_agt002_durable_batched_analysis',
];
const PREEXISTING_TABLES_TO_PRESERVE = [
  'psi_tender_document_versions',
  'psi_tender_document_extractions',
  'psi_agt002_analysis_worksets',
];

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: Phase 2 of the governed document worksets plan needs the next available additive migration 084_agt002_governed_document_worksets`,
  );
  return readFileSync(url, 'utf8');
}

function migrationSql() {
  return withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/084_agt002_governed_document_worksets.sql'));
}

function rollbackSql() {
  return withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/084_agt002_governed_document_worksets_rollback.sql'));
}

/** The text of one `create table ... (...)` block for a given table name. */
function tableBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+table\s+(if\s+not\s+exists\s+)?public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 084 must define public.${name}`);
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

/** The text of one `create or replace function ... $$;` block. */
function functionBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 084 must define public.${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `public.${name} must be a complete function body`);
  return sql.slice(start, end + 3);
}

/** The text of one `create trigger ... on public.<table> ...` block, ending at the statement `;`. */
function triggerBlockOn(sql, table) {
  const start = sql.search(new RegExp(String.raw`create\s+trigger\s+\S+\s+before\s+update\s+or\s+delete\s+on\s+public\.${table}\b`, 'i'));
  assert.notEqual(start, -1, `migration 084 must define an append-only trigger on public.${table}`);
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

test('migration 084 exists, is one transaction, and stays additive beside every preexisting document/AGT-002 object', () => {
  const migration = migrationSql();
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');
  assert.doesNotMatch(migration, /drop\s+table/i, 'migration 084 must never drop an existing table');
  assert.doesNotMatch(migration, /alter\s+table[^;]*drop\s+column/i, 'migration 084 must never drop an existing column');

  for (const fn of PREEXISTING_TO_PRESERVE) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\b`, 'i'),
      `migration 084 must never redefine the preexisting public.${fn}: document identity/extraction and the durable analysis workset are governed elsewhere and stay untouched`,
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
    assert.match(
      migration,
      new RegExp(String.raw`revoke\s+all\s+on\s+table\s+public\.${table}\s+from\s+[^;]*\bpublic\b[^;]*;`, 'i'),
      `public.${table} must revoke all from public`,
    );
    for (const role of ['anon', 'authenticated', 'service_role']) {
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

test('psi_agt002_governed_document_worksets: one frozen header per exact (opportunity, tender, selection) identity', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, WORKSET_TABLE);

  assert.match(block, /opportunity_id\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_opportunities/i);
  assert.match(block, /tender_id\s+uuid\s+not\s+null\s+references\s+public\.psi_public_tenders/i);
  assert.match(
    block, /selection_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*selection_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is,
    'selection_hash must be a validated SHA-256 hex digest, matching freezeAgt002WorksetEvidence()\'s selectionHash',
  );
  assert.match(
    block, /member_count\s+integer\s+not\s+null[^,]*check\s*\([^)]*member_count\s*>=?\s*1[^)]*\)/is,
    'member_count must be bounded at the low end (JS MIN_MEMBERS = 1)',
  );
  assert.match(
    block, /member_count[\s\S]{0,80}<=\s*12/i,
    'member_count must be bounded at the high end (JS MAX_MEMBERS = 12)',
  );
  assert.match(
    block, /created_by\s+uuid\s+not\s+null\s+references\s+public\.psi_sales_profiles/i,
    'the freezing actor must reference a real profile, never a free-text/anonymous field',
  );
  assert.match(
    block, /unique\s*\(\s*opportunity_id\s*,\s*tender_id\s*,\s*selection_hash\s*\)/i,
    'the workset identity is exactly (opportunity_id, tender_id, selection_hash): an exact-content replay reuses the row',
  );
  assert.match(
    block, /snapshot_id\s+uuid\s+not\s+null\s+references\s+public\.psi_tender_document_snapshots/i,
    'the frozen header must bind the exact document snapshot the package was resolved against, matching psi_agt002_reanalysis_jobs.snapshot_id (068)',
  );
  assert.match(
    block, /context_version_id\s+uuid\s+not\s+null\s+references\s+public\.psi_agt002_context_versions/i,
    'the frozen header must bind the exact AGT-002 context version (051) the package was resolved against, matching psi_agt002_reanalysis_jobs.context_version_id (068)',
  );
  assert.match(
    block, /idempotency_key\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*idempotency_key\s*\)/is,
    'the frozen header must carry the same non-blank idempotency_key that reaches psi_create_agt002_reanalysis_job, so a client replay is provably the same request',
  );
});

test('psi_agt002_governed_document_workset_members: frozen evidence mirrors freezeAgt002WorksetEvidence()\'s output shape exactly', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, MEMBER_TABLE);

  assert.match(block, new RegExp(String.raw`workset_id\s+uuid\s+not\s+null\s+references\s+public\.${WORKSET_TABLE}`, 'i'));
  assert.match(
    block, /document_version_id\s+uuid\s+not\s+null\s+references\s+public\.psi_tender_document_versions/i,
    'every member must reference a real, existing document version row (026)',
  );

  assert.match(
    block, /source_classification\s+text\s+not\s+null[^,]*check\s*\(\s*source_classification\s+in\s*\(([^)]+)\)\s*\)/is,
    'source_classification must be a closed check constraint',
  );
  const classificationMatch = block.match(/source_classification\s+text\s+not\s+null[^,]*check\s*\(\s*source_classification\s+in\s*\(([^)]+)\)\s*\)/is);
  const classifications = classificationMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(
    classifications.sort(),
    ['corporate', 'draft', 'internal', 'official', 'third_party'],
    'source_classification must be exactly AGT002_WORKSET_SOURCE_CLASSIFICATIONS from agt002-governed-document-worksets.js, no more, no fewer',
  );

  assert.match(
    block, /inclusion_reason\s+text\s+not\s+null[^,]*check\s*\([^)]*nullif\s*\(\s*btrim\s*\(\s*inclusion_reason\s*\)/is,
    'inclusion_reason must be required and non-blank, matching normalizeRequestedAgt002WorksetMembers()',
  );
  assert.match(
    block, /inclusion_reason[\s\S]{0,200}<=\s*500/i,
    'inclusion_reason must be bounded at 500 characters (JS MAX_REASON_LENGTH)',
  );

  assert.match(
    block, /content_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*content_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is,
    'content_hash must be a validated SHA-256 hex digest',
  );
  assert.match(
    block, /extraction_id\s+uuid\s+not\s+null\s+references\s+public\.psi_tender_document_extractions/i,
    'extraction_id must reference a real typed extraction row (065), never a free-text/derived id',
  );
  assert.match(
    block, /extraction_text_hash\s+text\s+not\s+null[^,]*check\s*\([^)]*extraction_text_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\)/is,
    'extraction_text_hash must be a validated SHA-256 hex digest',
  );

  assert.match(
    block, /unique\s*\(\s*workset_id\s*,\s*document_version_id\s*\)/i,
    'a document version can appear at most once per frozen workset (normalizeRequestedAgt002WorksetMembers() rejects duplicates)',
  );

  assert.doesNotMatch(
    block, /\bextracted_text\b|\bstorage_path\b|\bsource_url\b|\bsigned_url\b/i,
    'a frozen member row must never carry raw extracted text or storage/source locators — those are stripped by publicAgt002WorksetSummary() and must never be persisted onto the frozen row either',
  );
});

test('psi_agt002_governed_document_workset_runs: exactly one enqueued run per frozen workset', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, RUN_TABLE);

  assert.match(
    block, new RegExp(String.raw`workset_id\s+uuid\s+not\s+null\s+references\s+public\.${WORKSET_TABLE}[^,]*unique|unique[^,]*workset_id`, 'is'),
    'a run must reference exactly one workset, and a workset may enqueue at most one run (single "Run AGT-002 analysis" CTA, no re-run of the same frozen package)',
  );
  assert.match(
    block, /reanalysis_job_id\s+uuid\s+not\s+null\s+references\s+public\.psi_agt002_reanalysis_jobs/i,
    'a run must be bound to a real durable reanalysis job (068) by foreign key — the run\'s lifecycle is the job\'s lifecycle, never tracked a second time on this row',
  );
  assert.doesNotMatch(
    block, /\bstatus\s+text\b/i,
    'the run row must never carry its own standalone status column: status lives exactly once, on psi_agt002_reanalysis_jobs, reached via reanalysis_job_id',
  );
  assert.doesNotMatch(
    block, /\bprompt\b|\braw_output\b|\bcredential\b/i,
    'the run table must never carry a raw prompt, raw output or credential column',
  );
});

test('psi_agt002_governed_document_workset_runs: a run row can never exist as a disconnected, local-only queued row', () => {
  const migration = migrationSql();
  const block = tableBlock(migration, RUN_TABLE);
  assert.doesNotMatch(
    block, /status\s+text\s+not\s+null[^,]*check\s*\(\s*status\s+in\s*\(\s*'queued'/is,
    'a run row must never carry its own local "queued" status independent of psi_agt002_reanalysis_jobs — that would let a run exist queued locally while disconnected from any real durable job',
  );
  assert.match(
    block, /reanalysis_job_id\s+uuid\s+not\s+null/i,
    'reanalysis_job_id must be not null: a run row can never be inserted before it is already bound to a real reanalysis job row',
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

test('psi_resolve_agt002_governed_document_candidate joins the real version/extraction registers and enforces scope', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, RESOLVE_FN);
  assert.match(
    block, /from\s+public\.psi_tender_document_versions/i,
    'resolution must read the real document version register (026), never a client-supplied hash',
  );
  assert.match(
    block, /psi_tender_document_extractions/i,
    'resolution must read the real typed extraction register (065) for extraction_id/status/text_hash',
  );
  assert.match(
    block, /raise\s+exception/i,
    'a document_version_id that belongs to a different opportunity/tender must fail closed rather than silently return cross-scope evidence',
  );
});

test('psi_freeze_agt002_governed_document_workset: only an active, Licitaciones-and-custody-authorized human actor may freeze', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, /psi_profile_permissions/i,
    'the freeze RPC must check public.psi_profile_permissions, the real module-authorization table (021), not an ad hoc role string',
  );
  assert.match(
    block, /'licitaciones'/i,
    'the freeze RPC must require the exact "licitaciones" permission code (021), matching the plan\'s "Licitaciones-authorized" custody user',
  );
  assert.match(
    block, /'licitaciones_custodia'/i,
    'the freeze RPC must additionally require the exact "licitaciones_custodia" permission code (029): document custody authority, not general Licitaciones access alone, gates freezing a governed package',
  );
  assert.match(
    block, /identity_type\s*=\s*'human'/i,
    'the freeze RPC must require a human actor: an agent must never freeze a governed document package on its own',
  );
  assert.match(
    block, /active\s*(=|is)\s*true|active\s+is\s+distinct\s+from\s+true/i,
    'the freeze RPC must require an active profile: a deactivated custody user must fail closed even while their permission rows still exist',
  );
  assert.match(block, /raise\s+exception/i, 'an unauthorized, inactive, or non-human actor must fail closed');
});

test('psi_freeze_agt002_governed_document_workset: accepts and binds the exact snapshot/context/idempotency/frozen-input identity the reanalysis job will be created from', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  const signature = block.slice(0, block.indexOf(')') + 1);
  assert.match(
    signature, /p_snapshot_id\s+uuid/i,
    'the freeze RPC must accept p_snapshot_id: the package must be frozen against one exact document snapshot',
  );
  assert.match(
    signature, /p_context_version_id\s+uuid/i,
    'the freeze RPC must accept p_context_version_id: the package must be frozen against one exact AGT-002 context version',
  );
  assert.match(
    signature, /p_idempotency_key\s+text/i,
    'the freeze RPC must accept p_idempotency_key: a client replay must be provably the same request',
  );
  assert.match(
    signature, /p_frozen_engine_input\s+jsonb/i,
    'the freeze RPC must accept p_frozen_engine_input: the exact engine input the durable reanalysis job will execute',
  );
});

test('psi_freeze_agt002_governed_document_workset: re-verifies the submitted snapshot and context version belong to the same opportunity/tender scope', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, /from\s+public\.psi_tender_document_snapshots/i,
    'the freeze RPC must read the real snapshot register (051) rather than trust p_snapshot_id blindly',
  );
  assert.match(
    block, /from\s+public\.psi_agt002_context_versions/i,
    'the freeze RPC must read the real context version register (051) rather than trust p_context_version_id blindly',
  );
  assert.match(
    block, /raise\s+exception/i,
    'a snapshot or context version outside the (opportunity_id, tender_id) scope of this freeze must fail closed',
  );
});

test('psi_freeze_agt002_governed_document_workset: fails closed unless p_frozen_engine_input carries a document_workset_identity matching the freeze it rides along with', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block,
    /frozen_engine_input\s*(->|#>>?)\s*'(\{)?document_workset_identity/i,
    'the freeze RPC must read document_workset_identity out of p_frozen_engine_input — it must never assume the client-declared engine input matches the freeze it is attached to',
  );
  assert.match(
    block, /document_workset_identity[\s\S]{0,300}(is\s+distinct\s+from|<>|!=)/i,
    'a mismatch between p_frozen_engine_input\'s document_workset_identity and this freeze\'s own (opportunity_id, tender_id, selection_hash) must fail closed',
  );
});

test('psi_freeze_agt002_governed_document_workset: p_frozen_engine_input must declare schema_version, engine_identity, analysis_flags, and analysis_context, each read and structurally validated', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  for (const field of ['schema_version', 'engine_identity', 'analysis_flags', 'analysis_context']) {
    assert.match(
      block,
      new RegExp(String.raw`frozen_engine_input\s*(->|#>>?|->>?)\s*'(\{)?${field}`, 'i'),
      `the freeze RPC must read ${field} out of p_frozen_engine_input — a frozen engine input missing ${field} must never reach the durable reanalysis queue`,
    );
  }
  for (const field of ['engine_identity', 'analysis_flags', 'analysis_context']) {
    assert.match(
      block,
      new RegExp(String.raw`${field}[\s\S]{0,300}(is\s+null|jsonb_typeof)`, 'i'),
      `${field} must be validated as a structured jsonb object, not merely present`,
    );
  }
  assert.match(
    block, /raise\s+exception/i,
    'a p_frozen_engine_input missing any of schema_version/engine_identity/analysis_flags/analysis_context must fail closed',
  );
});

test('psi_freeze_agt002_governed_document_workset: p_frozen_engine_input.governed_workset_members must equal the canonical p_members projection exactly, in canonical sorted order — no absent, extra, omitted, reordered or divergent members', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block,
    /frozen_engine_input\s*(->|#>>?|->>?)\s*'(\{)?governed_workset_members/i,
    'the freeze RPC must read governed_workset_members out of p_frozen_engine_input and validate it against the re-verified, canonically ordered member selection — never trust a client-declared engine input to independently describe which documents are governed',
  );
  assert.match(
    block,
    /governed_workset_members[\s\S]{0,600}(is\s+distinct\s+from|<>|!=)/i,
    'a governed_workset_members projection diverging from the canonical p_members projection (document_version_id/source_classification/inclusion_reason, sorted by document_version_id) must fail closed: no absent, extra, omitted, reordered or divergent member may ever reach the durable reanalysis queue',
  );
});

test('psi_freeze_agt002_governed_document_workset: fail-closed re-verification of every member against live evidence, never the client-trusted payload alone', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);

  assert.match(
    block, /jsonb_array_length\s*\(\s*p_members\s*\)/i,
    'the freeze RPC must bound p_members server-side, mirroring normalizeRequestedAgt002WorksetMembers()\'s 1..12 bound instead of trusting the caller',
  );
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
    'the freeze RPC must re-verify the submitted content_hash against the live psi_tender_document_versions row, never take the Node-computed value on faith',
  );
  assert.match(
    block, /extraction_text_hash[\s\S]{0,200}(is\s+distinct\s+from|<>|!=)|text_hash[\s\S]{0,200}(is\s+distinct\s+from|<>|!=)/i,
    'the freeze RPC must re-verify the submitted extraction_text_hash against the live psi_tender_document_extractions row',
  );
  assert.match(block, /raise\s+exception/i, 'any mismatch must fail closed: no partial package is ever persisted');
});

test('psi_freeze_agt002_governed_document_workset: exact-identity idempotent reuse, fail-closed on any conflicting replay', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, new RegExp(String.raw`select[\s\S]{0,300}from\s+public\.${WORKSET_TABLE}`, 'i'),
    'the freeze RPC must look up an existing workset under the same (opportunity_id, tender_id, selection_hash) identity before inserting',
  );
  assert.match(
    block, /raise\s+exception/i,
    'a replay whose members differ from an already-frozen workset of the same identity must fail closed, never silently pick one side',
  );
  assert.match(
    block, /snapshot_id\s+is\s+distinct\s+from|snapshot_id\s*(<>|!=)/i,
    'a replay under the same (opportunity_id, tender_id, selection_hash) identity but a different snapshot_id must fail closed, never silently reuse a stale snapshot',
  );
  assert.match(
    block, /context_version_id\s+is\s+distinct\s+from|context_version_id\s*(<>|!=)/i,
    'a replay under the same identity but a different context_version_id must fail closed',
  );
  assert.match(
    block, /idempotency_key\s+is\s+distinct\s+from|idempotency_key\s*(<>|!=)/i,
    'a replay under the same identity but a different idempotency_key must fail closed',
  );
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${WORKSET_TABLE}`, 'i'),
    'a genuinely new identity must insert a new workset header row',
  );
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${MEMBER_TABLE}`, 'i'),
    'freezing must insert every member row',
  );
});

test('psi_freeze_agt002_governed_document_workset: freeze and enqueue happen atomically in the same function body', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${RUN_TABLE}`, 'i'),
    'the freeze RPC must enqueue exactly one run row in the same transaction as the freeze, so a package is never left frozen without a run (or vice versa)',
  );
  assert.doesNotMatch(
    block, /exception\s+when\s+others\s+then/i,
    'the freeze RPC must never catch-and-continue past a validation or insert failure: the whole transaction must roll back, leaving no partial package or orphaned run',
  );
});

test('psi_freeze_agt002_governed_document_workset: enqueues through the real durable reanalysis job queue and persists its id onto the run row', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  assert.match(
    block, /public\.psi_create_agt002_reanalysis_job\s*\(/i,
    'the freeze RPC must call the existing psi_create_agt002_reanalysis_job (068) rather than reimplement queueing or invent a second, disconnected run status',
  );
  assert.match(
    block, new RegExp(String.raw`insert\s+into\s+public\.${RUN_TABLE}[\s\S]{0,400}reanalysis_job_id`, 'i'),
    'the job id returned by psi_create_agt002_reanalysis_job must be persisted as the run row\'s reanalysis_job_id — the run and the job are the same lifecycle, never two independently tracked ones',
  );
});

test('psi_freeze_agt002_governed_document_workset: forwards p_frozen_engine_input into psi_create_agt002_reanalysis_job unmodified — never a derived/re-shaped expression', () => {
  const migration = migrationSql();
  const block = functionBlock(migration, FREEZE_FN);
  const callStart = block.search(/public\.psi_create_agt002_reanalysis_job\s*\(/i);
  assert.notEqual(callStart, -1, 'the freeze RPC must call psi_create_agt002_reanalysis_job');
  const callEnd = block.indexOf(')', callStart);
  assert.notEqual(callEnd, -1, 'the psi_create_agt002_reanalysis_job call must be a complete, balanced argument list');
  const call = block.slice(callStart, callEnd + 1);
  assert.match(
    call, /,\s*p_frozen_engine_input\s*,/,
    'p_frozen_engine_input must be forwarded as its own bare argument to psi_create_agt002_reanalysis_job — never wrapped, merged with the declared document_workset_identity, or rebuilt before reaching the durable job row',
  );
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

test('the rollback exists, is one transaction, and fails closed while any workset/member/run history exists', () => {
  const rollback = rollbackSql();
  assert.match(rollback, /^\s*begin;/im, 'the rollback must run inside one transaction');
  assert.match(rollback, /^\s*commit;/im, 'the rollback must commit its single transaction');
  assert.match(
    rollback, /raise\s+exception/i,
    'the rollback must fail closed while frozen worksets/members/runs still exist, so rollback can never silently strand governed document history',
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

  // Dependency order: members and runs reference worksets, so they must drop first.
  const worksetsDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${WORKSET_TABLE}\b`, 'i'));
  for (const dependent of [MEMBER_TABLE, RUN_TABLE]) {
    const dependentDropIdx = rollback.search(new RegExp(String.raw`drop\s+table\s+if\s+exists\s+public\.${dependent}\b`, 'i'));
    assert.ok(
      dependentDropIdx !== -1 && dependentDropIdx < worksetsDropIdx,
      `the rollback must drop public.${dependent} before public.${WORKSET_TABLE}`,
    );
  }

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

console.log('AGT-002 governed document worksets migration 084 static structural contract passed');
