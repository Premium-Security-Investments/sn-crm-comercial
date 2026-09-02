// AGT-002 fenced lease heartbeat — static migration contract (RED, no production change).
//
// Pins the SQL half of the deterministic stage-boundary heartbeat: one NEW, strictly ADDITIVE
// migration (079, the next available number) that adds exactly two SECURITY DEFINER renewal RPCs
// beside the reservations that already exist —
//   * public.psi_renew_agt002_preview_claim(text, uuid, integer)      for migration 028's
//     psi_agt002_preview_claims, fenced by BOTH idempotency_key AND the claim_id token;
//   * public.psi_renew_agt002_reanalysis_job_lease(uuid, uuid, integer) for migration 068's
//     psi_agt002_reanalysis_jobs, fenced by BOTH id AND the lease_id token.
//
// Neither file exists yet — that absence is the RED signal, reported explicitly below instead of as
// an unreadable-file crash. Assertions target SECURITY and FENCING SEMANTICS (definer + pinned
// search_path, both fencing tokens in the same predicate, expiry rejection, the 1..600 bound,
// running-only for the queue, revoke-then-grant to service_role only, and no free-text/raw-provider
// parameter anywhere). Nothing here asserts formatting or whitespace for its own sake.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const MIGRATION_URL = new URL('../supabase/migrations/079_agt002_lease_heartbeat.sql', import.meta.url);
const ROLLBACK_URL = new URL('../supabase/rollbacks/079_agt002_lease_heartbeat_rollback.sql', import.meta.url);

const PREVIEW_FN = 'psi_renew_agt002_preview_claim';
const PREVIEW_ARGS = String.raw`\(\s*text\s*,\s*uuid\s*,\s*integer\s*\)`;
const REANALYSIS_FN = 'psi_renew_agt002_reanalysis_job_lease';
const REANALYSIS_ARGS = String.raw`\(\s*uuid\s*,\s*uuid\s*,\s*integer\s*\)`;

/** Statement text only: an explanatory `--` comment must never satisfy — or trip — a security check. */
function withoutComments(sql) {
  return sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
}

function readSql(url, label) {
  assert.ok(
    existsSync(url),
    `${label} must exist: the fenced lease heartbeat needs the next available additive migration 079_agt002_lease_heartbeat`,
  );
  return readFileSync(url, 'utf8');
}

/** The text of one `create or replace function ... $$;` block, so predicates are asserted inside the
 * function that owns them and never accidentally satisfied by the other RPC in the same file. */
function functionBlock(sql, name) {
  const start = sql.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\b`, 'i'));
  assert.notEqual(start, -1, `migration 079 must define public.${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `public.${name} must be a complete function body`);
  return sql.slice(start, end + 3);
}

/** Every role named in any `revoke all on function public.<fn>(<args>) from <roles>;` statement. */
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

function assertRenewalFunctionSecurity(block, name) {
  assert.match(block, /security\s+definer/i, `public.${name} must be SECURITY DEFINER: the heartbeat is service-owned, never caller-owned`);
  assert.match(block, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `public.${name} must pin its search_path`);
  assert.match(block, /\)\s*returns\s+jsonb/i, `public.${name} must return the structured jsonb outcome, never a bare boolean that cannot express "lost"`);
  assert.match(block, /'renewed'/i, `public.${name} must be able to report a renewed lease`);
  assert.match(block, /'lost'/i, `public.${name} must be able to report a lost lease instead of silently succeeding`);
  assert.match(block, /'lease_expires_at'/i, `public.${name} must return the new lease expiry so the caller can prove the renewal landed`);
}

function assertLeaseSecondsBound(block, name) {
  // Mirrors migration 028's own explicit style: NULL is closed first, then both ends of the window.
  // A bare `p_lease_seconds not between 1 and 600` would evaluate to NULL for a NULL argument and the
  // guard would simply not fire — that is exactly the permissive path this assertion forbids.
  assert.match(
    block, /p_lease_seconds\s+is\s+null|coalesce\(\s*p_lease_seconds/i,
    `public.${name} must close a NULL lease duration explicitly instead of letting a NULL comparison fall through`,
  );
  assert.match(block, /p_lease_seconds\s*(<=\s*0|<\s*1)/i, `public.${name} must reject a non-positive lease duration`);
  assert.match(block, /p_lease_seconds\s*>\s*600/i, `public.${name} must reject a lease duration above the 600s operational ceiling`);
}

test('migration 079 exists and stays strictly additive', () => {
  const migration = withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/079_agt002_lease_heartbeat.sql'));
  assert.match(migration, /^\s*begin;/im, 'the migration must run inside one transaction');
  assert.match(migration, /^\s*commit;/im, 'the migration must commit its single transaction');

  assert.doesNotMatch(migration, /drop\s+table/i, 'a lease-heartbeat migration must never drop a table');
  assert.doesNotMatch(migration, /alter\s+table[^;]*drop\s+column/i, 'a lease-heartbeat migration must never drop a column');
  for (const existing of [
    'psi_claim_agt002_preview_run',
    'psi_release_agt002_preview_claim',
    'psi_claim_agt002_reanalysis_job',
    'psi_complete_agt002_reanalysis_job',
    'psi_fail_agt002_reanalysis_job',
  ]) {
    assert.doesNotMatch(
      migration, new RegExp(String.raw`(create\s+or\s+replace|drop)\s+function\s+(if\s+exists\s+)?public\.${existing}\b`, 'i'),
      `migration 079 must add the heartbeat beside public.${existing}, never redefine or drop it`,
    );
  }
});

test('the preview renewal RPC is fenced by BOTH idempotency_key and claim_id', () => {
  const migration = withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/079_agt002_lease_heartbeat.sql'));
  assert.match(
    migration,
    new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${PREVIEW_FN}\s*\(\s*p_idempotency_key\s+text\s*,\s*p_claim_id\s+uuid\s*,\s*p_lease_seconds\s+integer\s*\)`, 'i'),
    'the preview renewal must take exactly (p_idempotency_key text, p_claim_id uuid, p_lease_seconds integer), in that order',
  );

  const block = functionBlock(migration, PREVIEW_FN);
  assertRenewalFunctionSecurity(block, PREVIEW_FN);
  assertLeaseSecondsBound(block, PREVIEW_FN);

  assert.match(block, /update\s+public\.psi_agt002_preview_claims/i, 'the preview renewal must update the existing claims table, never a new shadow table');
  assert.match(block, /make_interval\s*\(\s*secs\s*=>\s*p_lease_seconds|p_lease_seconds\s*\*\s*interval/i, 'the renewal must extend lease_expires_at by exactly the validated lease seconds');

  // Fencing: BOTH the identity and the fencing token must constrain the same statement, so a stale
  // worker holding a superseded claim_id can never extend the lease of the claim that replaced it.
  assert.match(block, /idempotency_key\s*=\s*p_idempotency_key/i, 'the preview renewal must be keyed by idempotency_key');
  assert.match(block, /claim_id\s*=\s*p_claim_id/i, 'the preview renewal must be fenced by the claim_id token, not by the idempotency key alone');
  assert.match(
    block, /idempotency_key\s*=\s*p_idempotency_key[\s\S]{0,200}?claim_id\s*=\s*p_claim_id|claim_id\s*=\s*p_claim_id[\s\S]{0,200}?idempotency_key\s*=\s*p_idempotency_key/i,
    'both fencing predicates must constrain the SAME update; either one alone is not a fence',
  );

  // An expired lease has already been (or may already be) reclaimed: renewing it would resurrect a
  // reservation somebody else may now own.
  assert.match(
    block, /lease_expires_at\s*>\s*(now\(\)|clock_timestamp\(\)|v_now)/i,
    'the preview renewal must refuse an already-expired lease instead of resurrecting it',
  );
});

test('the reanalysis renewal RPC is fenced by BOTH job_id and lease_id and only renews a running job', () => {
  const migration = withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/079_agt002_lease_heartbeat.sql'));
  assert.match(
    migration,
    new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${REANALYSIS_FN}\s*\(\s*p_job_id\s+uuid\s*,\s*p_lease_id\s+uuid\s*,\s*p_lease_seconds\s+integer\s*\)`, 'i'),
    'the reanalysis renewal must take exactly (p_job_id uuid, p_lease_id uuid, p_lease_seconds integer), in that order',
  );

  const block = functionBlock(migration, REANALYSIS_FN);
  assertRenewalFunctionSecurity(block, REANALYSIS_FN);
  assertLeaseSecondsBound(block, REANALYSIS_FN);

  assert.match(block, /update\s+public\.psi_agt002_reanalysis_jobs/i, 'the reanalysis renewal must update the existing jobs table, never a new shadow table');
  assert.match(block, /make_interval\s*\(\s*secs\s*=>\s*p_lease_seconds|p_lease_seconds\s*\*\s*interval/i, 'the renewal must extend lease_expires_at by exactly the validated lease seconds');

  assert.match(block, /\bid\s*=\s*p_job_id/i, 'the reanalysis renewal must be keyed by the job id');
  assert.match(block, /lease_id\s*=\s*p_lease_id/i, 'the reanalysis renewal must be fenced by the lease_id token, not by the job id alone');
  assert.match(
    block, /\bid\s*=\s*p_job_id[\s\S]{0,200}?lease_id\s*=\s*p_lease_id|lease_id\s*=\s*p_lease_id[\s\S]{0,200}?\bid\s*=\s*p_job_id/i,
    'both fencing predicates must constrain the SAME update; either one alone is not a fence',
  );
  assert.match(
    block, /status\s*=\s*'running'/i,
    "only a job still in 'running' may be renewed: a queued, completed or terminally unavailable job must never be revived by a heartbeat",
  );
  assert.match(
    block, /lease_expires_at\s*>\s*(now\(\)|clock_timestamp\(\)|v_now)/i,
    'the reanalysis renewal must refuse an already-expired lease, which psi_claim_agt002_reanalysis_job may already have closed as lease_lost',
  );
});

test('both renewal RPCs are revoked from every role and then granted only to service_role', () => {
  const migration = withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/079_agt002_lease_heartbeat.sql'));
  for (const [fn, args] of [[PREVIEW_FN, PREVIEW_ARGS], [REANALYSIS_FN, REANALYSIS_ARGS]]) {
    const revoked = privilegeRoles(migration, 'revoke', fn, args);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      assert.ok(revoked.roles.has(role), `public.${fn} must revoke all from ${role} before granting anything`);
    }
    const granted = privilegeRoles(migration, 'grant', fn, args);
    assert.deepEqual(
      [...granted.roles].sort(), ['service_role'],
      `public.${fn} must grant execute to service_role and to nobody else`,
    );
    assert.ok(granted.indices.length > 0, `public.${fn} must grant execute to service_role`);
    assert.ok(
      Math.max(...revoked.indices) < Math.min(...granted.indices),
      `public.${fn} must revoke first and grant afterwards, so the grant is never undone by a later revoke`,
    );
  }
});

test('no renewal parameter can carry free text or raw provider data', () => {
  const migration = withoutComments(readSql(MIGRATION_URL, 'supabase/migrations/079_agt002_lease_heartbeat.sql'));
  // The exact three-parameter signatures asserted above are the primary guarantee; this closes the
  // door on any additional payload-shaped parameter reaching either heartbeat surface.
  assert.doesNotMatch(
    migration, /p_(error_message|message|result|content|prompt|policy_text|raw[a-z_]*|usage|model|output|text)\b/i,
    'a heartbeat carries identity and a bounded duration only — no free text, model output or provider payload parameter',
  );
  assert.doesNotMatch(migration, /\bp_[a-z_]+\s+jsonb\b/i, 'no renewal parameter may be a jsonb payload');
});

test('the rollback removes only the two new renewal RPCs', () => {
  const rollback = withoutComments(readSql(ROLLBACK_URL, 'supabase/rollbacks/079_agt002_lease_heartbeat_rollback.sql'));
  assert.match(rollback, new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${PREVIEW_FN}`, 'i'));
  assert.match(rollback, new RegExp(String.raw`drop\s+function\s+if\s+exists\s+public\.${REANALYSIS_FN}`, 'i'));
  assert.doesNotMatch(rollback, /drop\s+table/i, 'the rollback must never drop the reservation tables the heartbeat only reads and extends');
  for (const existing of [
    'psi_claim_agt002_preview_run',
    'psi_release_agt002_preview_claim',
    'psi_claim_agt002_reanalysis_job',
    'psi_complete_agt002_reanalysis_job',
    'psi_fail_agt002_reanalysis_job',
  ]) {
    assert.doesNotMatch(
      rollback, new RegExp(String.raw`drop\s+function\s+(if\s+exists\s+)?public\.${existing}\b`, 'i'),
      `the rollback must not remove the preexisting public.${existing}`,
    );
  }
});
