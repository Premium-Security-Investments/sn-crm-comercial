import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION_092_PATH = fileURLToPath(
  new URL('../supabase/migrations/092_agt002_f0b_chat_query_revoke.sql', import.meta.url),
);
const MIGRATION_094_PATH = fileURLToPath(
  new URL('../supabase/migrations/094_agt002_f0b2_rpc_hardening.sql', import.meta.url),
);

const PSI_ADMIN_FUNCTIONS = [
  'psi_admin_acquire_profile_lock',
  'psi_admin_release_profile_lock',
  'psi_admin_bind_profile_auth',
  'psi_admin_persist_profile_access',
];

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map(line => {
      const commentIndex = line.indexOf('--');
      return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    })
    .join('\n');
}

function checkMigration092(sql, errors) {
  const uncommented = stripSqlComments(sql);
  const statements = uncommented
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const role of ['public', 'anon', 'authenticated']) {
    const revoked = statements.some(
      statement =>
        new RegExp(`revoke\\s+(execute|all)\\s+on\\s+function\\s+public\\.chat_query\\s*\\(`, 'i').test(statement) &&
        /\bfrom\b/i.test(statement) &&
        new RegExp(`\\b${role}\\b`, 'i').test(statement.slice(statement.search(/\bfrom\b/i))),
    );
    if (!revoked) {
      errors.push(`092: expected uncommented SQL to revoke EXECUTE/ALL on public.chat_query from ${role}`);
    }
  }

  const grantStatements = statements.filter(statement =>
    new RegExp(`grant\\s+(execute|all)\\s+on\\s+function\\s+public\\.chat_query\\s*\\(`, 'i').test(statement),
  );
  for (const statement of grantStatements) {
    const toIndex = statement.search(/\bto\b/i);
    const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
    for (const role of ['public', 'anon', 'authenticated']) {
      if (new RegExp(`\\b${role}\\b`, 'i').test(toClause)) {
        errors.push(`092: must not grant EXECUTE/ALL on public.chat_query to ${role}`);
      }
    }
  }
}

function checkMigration094(sql, errors) {
  const uncommented = stripSqlComments(sql);
  const statements = uncommented
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const fnName of PSI_ADMIN_FUNCTIONS) {
    const revokeFromAnon = statements.some(
      statement =>
        new RegExp(`revoke\\s+(execute|all)\\s+on\\s+function\\s+public\\.${fnName}\\s*\\(`, 'i').test(statement) &&
        /\bfrom\b/i.test(statement) &&
        /\banon\b/i.test(statement.slice(statement.search(/\bfrom\b/i))),
    );
    if (!revokeFromAnon) {
      errors.push(`094: expected uncommented SQL to revoke EXECUTE/ALL on ${fnName} from anon`);
    }

    const grantStatements = statements.filter(statement =>
      new RegExp(`grant\\s+(execute|all)\\s+on\\s+function\\s+public\\.${fnName}\\s*\\(`, 'i').test(statement),
    );
    for (const statement of grantStatements) {
      const toIndex = statement.search(/\bto\b/i);
      const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
      for (const role of ['anon', 'authenticated']) {
        if (new RegExp(`\\b${role}\\b`, 'i').test(toClause)) {
          errors.push(`094: must not grant ${fnName} to ${role}`);
        }
      }
    }
  }
}

export function checkAgt002GrantsStaticFromSql({ sql092, sql094 }) {
  const errors = [];

  checkMigration092(sql092, errors);
  checkMigration094(sql094, errors);

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export async function checkAgt002GrantsStatic() {
  const migration092Sql = readFileSync(MIGRATION_092_PATH, 'utf8');
  const migration094Sql = readFileSync(MIGRATION_094_PATH, 'utf8');

  return checkAgt002GrantsStaticFromSql({ sql092: migration092Sql, sql094: migration094Sql });
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const result = await checkAgt002GrantsStatic();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
