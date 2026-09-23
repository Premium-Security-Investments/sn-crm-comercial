// AGT-002 Phase 01 — static contract for the NOT-APPLIED gate/authority storage design.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const designUrl = new URL('../supabase/migration-designs/agt002_phase01_executable_controls.sql', import.meta.url);
const designPath = fileURLToPath(designUrl);
const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

const sql = readFileSync(designPath, 'utf8');

const TABLE_GATE_INSTANCES = 'proposed_agt002_gate_instances';
const TABLE_AUTHORITY_GRANTS = 'proposed_agt002_authority_grants';
const TABLE_RECEIPTS = 'proposed_agt002_gate_consumption_receipts';

function tableBody(text, table) {
  const re = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(`, 'i');
  const m = re.exec(text);
  assert.ok(m, `missing CREATE TABLE for ${table}`);
  let depth = 1;
  let i = m.index + m[0].length;
  while (depth > 0 && i < text.length) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    i += 1;
  }
  assert.equal(depth, 0, `unbalanced parentheses in CREATE TABLE ${table}`);
  return text.slice(m.index + m[0].length, i - 1);
}

function assertEnumValues(body, column, values) {
  const re = new RegExp(`${column}\\s+text\\s+(?:not\\s+null\\s+)?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`, 'i');
  const m = re.exec(body);
  assert.ok(m, `${column} must have a check(${column} in (...)) enum constraint`);
  for (const value of values) {
    assert.ok(m[1].includes(`'${value}'`), `${column} check must include '${value}'`);
  }
}

// 1. Location: design artifact lives outside supabase/migrations/, never applied.
assert.ok(!designPath.includes('/supabase/migrations/'),
  'design SQL must not live under supabase/migrations/');
const migrationFiles = readdirSync(migrationsDir);
assert.ok(!migrationFiles.includes('agt002_phase01_executable_controls.sql'),
  'supabase/migrations/ must not gain a copy of the design artifact');

// 2. Header warning banner.
const header = sql.split('\n').slice(0, 20).join('\n');
assert.match(header, /NOT APPLIED/i, 'header must warn the design is NOT APPLIED');
assert.match(header, /DESIGN ONLY/i, 'header must warn this is DESIGN ONLY');
assert.match(header, /DO NOT APPLY/i, 'header must warn DO NOT APPLY');

// 3. Fail-closed executable guard: aborts if anyone runs the file anyway.
assert.match(sql, /do\s+\$\$\s*begin[\s\S]*raise\s+exception\s+'DO NOT APPLY[\s\S]*end\s+\$\$;/i,
  'design SQL must contain a fail-closed DO block that raises an exception if executed');

// 4. Three proposed tables with the required columns/constraints.
const gateInstancesBody = tableBody(sql, TABLE_GATE_INSTANCES);
const authorityGrantsBody = tableBody(sql, TABLE_AUTHORITY_GRANTS);
const receiptsBody = tableBody(sql, TABLE_RECEIPTS);

// proposed_agt002_gate_instances
assert.match(gateInstancesBody, /gate_id\s+text\s+primary\s+key/i);
assert.match(gateInstancesBody, /schema_version\s+text\s+not\s+null\s+check\s*\(\s*schema_version\s*=\s*'agt002-phase01-gate\/1\.0\.0'\s*\)/i);
assertEnumValues(gateInstancesBody, 'type', [
  'PHASE_AUDIT', 'LINK_VERIFICATION', 'AUTHORITY_DELEGATION', 'STORAGE_DESIGN_REVIEW', 'PRODUCTION_ACTION',
]);
assert.match(gateInstancesBody,
  new RegExp(`grant_id\\s+text\\s+not\\s+null\\s+references\\s+${TABLE_AUTHORITY_GRANTS}\\s*\\(\\s*grant_id\\s*\\)\\s*on\\s+delete\\s+restrict`, 'i'),
  'gate_id.grant_id must reference proposed_agt002_authority_grants(grant_id) on delete restrict');
assertEnumValues(gateInstancesBody, 'environment', ['production', 'isolated_fixture']);
assert.match(gateInstancesBody, /objective\s+text\s+not\s+null\s+check\s*\(\s*btrim\s*\(\s*objective\s*\)\s*<>\s*''\s*\)/i);
assert.match(gateInstancesBody, /issued_at_utc\s+timestamptz\s+not\s+null/i);
assert.match(gateInstancesBody, /expires_at_utc\s+timestamptz\s+not\s+null\s+check\s*\(\s*expires_at_utc\s*>\s*issued_at_utc\s*\)/i);
assertEnumValues(gateInstancesBody, 'status', ['DRAFT', 'OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED']);
assertEnumValues(gateInstancesBody, 'outcome', ['PASS', 'REJECTED', 'CANCELLED']);
assert.doesNotMatch(gateInstancesBody, /outcome\s+text\s+not\s+null/i,
  'outcome must stay nullable — lifecycle status and result are separate');
assert.match(gateInstancesBody, /artifact_set_hash\s+text\s+not\s+null\s+check\s*\(\s*artifact_set_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)/i);
assert.match(gateInstancesBody, /scope\s+jsonb\s+not\s+null/i);
assert.match(gateInstancesBody, /preconditions\s+jsonb\s+not\s+null/i);
assert.match(gateInstancesBody, /evidence\s+jsonb\s+not\s+null/i);
assert.match(gateInstancesBody, /rollback\s+jsonb\s+not\s+null/i);
assert.match(gateInstancesBody,
  /check\s*\(\s*\(\s*status\s+in\s*\(\s*'DRAFT'\s*,\s*'OPEN'\s*,\s*'EXPIRED'\s*,\s*'REVOKED'\s*\)\s+and\s+outcome\s+is\s+null\s*\)\s+or\s+\(\s*status\s*=\s*'CONSUMED'\s+and\s+outcome\s+is\s+not\s+null\s*\)\s*\)/i,
  'gate_instances must enforce the lifecycle/outcome separation check');

// proposed_agt002_authority_grants
assert.match(authorityGrantsBody, /grant_id\s+text\s+primary\s+key/i);
assert.match(authorityGrantsBody, /registry_version\s+int\s+not\s+null\s+check\s*\(\s*registry_version\s*>=\s*1\s*\)/i);
assert.match(authorityGrantsBody, /gate_type\s+text\s+not\s+null/i);
assert.match(authorityGrantsBody, /principal_id\s+text\s+not\s+null/i);
assertEnumValues(authorityGrantsBody, 'principal_kind', ['human', 'agent', 'synthetic']);
assert.match(authorityGrantsBody, /durable_ref\s+jsonb\s+not\s+null/i);
assert.match(authorityGrantsBody,
  new RegExp(`delegate_of\\s+text\\s+references\\s+${TABLE_AUTHORITY_GRANTS}\\s*\\(\\s*grant_id\\s*\\)\\s*on\\s+delete\\s+restrict`, 'i'),
  'delegate_of must self-reference proposed_agt002_authority_grants(grant_id) on delete restrict');
assert.match(authorityGrantsBody, /valid_from_utc\s+timestamptz\s+not\s+null/i);
assert.match(authorityGrantsBody, /valid_until_utc\s+timestamptz\s+not\s+null\s+check\s*\(\s*valid_until_utc\s*>\s*valid_from_utc\s*\)/i);
assert.match(authorityGrantsBody, /scope\s+jsonb\s+not\s+null/i);
assert.match(authorityGrantsBody, /revoked_at_utc\s+timestamptz/i);

// proposed_agt002_gate_consumption_receipts
assert.match(receiptsBody, /receipt_id\s+text\s+primary\s+key/i,
  'receipt_id must be unique via primary key');
assert.match(receiptsBody,
  new RegExp(`gate_id\\s+text\\s+not\\s+null\\s+references\\s+${TABLE_GATE_INSTANCES}\\s*\\(\\s*gate_id\\s*\\)\\s*on\\s+delete\\s+restrict`, 'i'),
  'receipts.gate_id must reference proposed_agt002_gate_instances(gate_id) on delete restrict');
assert.match(receiptsBody, /consumed_at_utc\s+timestamptz\s+not\s+null/i);
assert.match(receiptsBody, /consumed_by\s+text\s+not\s+null/i);
assertEnumValues(receiptsBody, 'outcome', ['PASS', 'REJECTED', 'CANCELLED']);
assert.match(receiptsBody, /unique\s*\(\s*gate_id\s*\)/i,
  'receipts must enforce max_consumptions=1 via unique(gate_id)');

// 5. RLS / REVOKE / fail-closed posture, documented for a productive store that does not exist yet.
assert.match(sql, /row level security/i);
assert.match(sql, /revoke/i);
assert.match(sql, /service_role/i);
assert.match(sql, /security definer/i);
assert.match(sql, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
assert.match(sql, /append-only/i);
assert.match(sql, /fail[- ]closed/i);

// 6. No DML statements anywhere in the design artifact (constraint clauses like
// "on delete restrict" or "before update or delete" triggers do not count).
const DML_STATEMENT = /\b(insert\s+into|update\s+[\w".]+\s+set|delete\s+from|merge\s+into|copy\s+[\w".]+|call\s+[\w".]+\s*\()/i;
assert.doesNotMatch(sql, DML_STATEMENT,
  'design artifact must not contain DML statements (INSERT/UPDATE/DELETE/MERGE/COPY/CALL)');

console.log('AGT-002 Phase 01 migration design static contract passed');
