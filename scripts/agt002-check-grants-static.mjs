import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATION_092_PATH = fileURLToPath(
  new URL('../supabase/migrations/092_agt002_f0b_chat_query_revoke.sql', import.meta.url),
);
const MIGRATION_094_PATH = fileURLToPath(
  new URL('../supabase/migrations/094_agt002_f0b2_rpc_hardening.sql', import.meta.url),
);
const MIGRATION_095_PATH = fileURLToPath(
  new URL('../supabase/migrations/095_agt002_f0_users_security.sql', import.meta.url),
);

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

// Vistas comerciales de AGT-003 cerradas por 112: nunca legibles con la llave pública y siempre security_invoker.
export const AGT003_COMMERCIAL_VIEWS = Object.freeze([
  'v_psi_sales_opportunity_enriched',
  'v_psi_sales_pipeline_summary',
  'v_psi_sales_kpis_by_commercial_month',
  'v_psi_sales_stalled_sustentacion',
  'v_psi_sales_top3_closing',
]);
const AGT003_VIEWS_MIGRATION_NUMBER = 112;
const PUBLIC_ROLES = ['public', 'anon', 'authenticated'];

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

function checkMigration095(sql, errors) {
  const uncommented = stripSqlComments(sql);
  const statements = uncommented
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);

  const enablesRls = statements.some(statement =>
    /alter\s+table\s+public\.usuarios\s+enable\s+row\s+level\s+security/i.test(statement),
  );
  if (!enablesRls) {
    errors.push('095: expected uncommented SQL to enable row level security on public.usuarios');
  }

  const forcesRls = statements.some(statement =>
    /alter\s+table\s+public\.usuarios\s+force\s+row\s+level\s+security/i.test(statement),
  );
  if (forcesRls) {
    errors.push('095: must not FORCE row level security on public.usuarios');
  }

  for (const role of ['public', 'anon', 'authenticated']) {
    const revoked = statements.some(
      statement =>
        /revoke\s+all\s+on\s+table\s+public\.usuarios\b/i.test(statement) &&
        /\bfrom\b/i.test(statement) &&
        new RegExp(`\\b${role}\\b`, 'i').test(statement.slice(statement.search(/\bfrom\b/i))),
    );
    if (!revoked) {
      errors.push(`095: expected uncommented SQL to revoke ALL table privileges on public.usuarios from ${role}`);
    }
  }

  const usuariosGrantStatements = statements.filter(statement =>
    /grant\s+all\s+on\s+table\s+public\.usuarios\b/i.test(statement),
  );
  const grantsUsuariosToServiceRole = usuariosGrantStatements.some(statement => {
    const toIndex = statement.search(/\bto\b/i);
    const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
    return /\bservice_role\b/i.test(toClause);
  });
  if (!grantsUsuariosToServiceRole) {
    errors.push('095: expected uncommented SQL to grant ALL on public.usuarios to service_role');
  }
  for (const statement of usuariosGrantStatements) {
    const toIndex = statement.search(/\bto\b/i);
    const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
    for (const role of ['public', 'anon', 'authenticated']) {
      if (new RegExp(`\\b${role}\\b`, 'i').test(toClause)) {
        errors.push(`095: must not grant ALL on public.usuarios to ${role}`);
      }
    }
  }

  for (const role of ['public', 'anon', 'authenticated']) {
    const revoked = statements.some(
      statement =>
        new RegExp(`revoke\\s+(execute|all)\\s+on\\s+function\\s+public\\.registrar_uso_ia\\s*\\(`, 'i').test(statement) &&
        /\bfrom\b/i.test(statement) &&
        new RegExp(`\\b${role}\\b`, 'i').test(statement.slice(statement.search(/\bfrom\b/i))),
    );
    if (!revoked) {
      errors.push(`095: expected uncommented SQL to revoke EXECUTE/ALL on public.registrar_uso_ia from ${role}`);
    }
  }

  const registrarGrantStatements = statements.filter(statement =>
    new RegExp(`grant\\s+(execute|all)\\s+on\\s+function\\s+public\\.registrar_uso_ia\\s*\\(`, 'i').test(statement),
  );
  const grantsRegistrarToServiceRole = registrarGrantStatements.some(statement => {
    const toIndex = statement.search(/\bto\b/i);
    const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
    return /\bservice_role\b/i.test(toClause);
  });
  if (!grantsRegistrarToServiceRole) {
    errors.push('095: expected uncommented SQL to grant EXECUTE on public.registrar_uso_ia to service_role');
  }
  for (const statement of registrarGrantStatements) {
    const toIndex = statement.search(/\bto\b/i);
    const toClause = toIndex >= 0 ? statement.slice(toIndex) : statement;
    for (const role of ['public', 'anon', 'authenticated']) {
      if (new RegExp(`\\b${role}\\b`, 'i').test(toClause)) {
        errors.push(`095: must not grant EXECUTE/ALL on public.registrar_uso_ia to ${role}`);
      }
    }
  }

  if (/\buso_ia_diario\b/i.test(uncommented)) {
    errors.push('095: must not reference the legacy uso_ia_diario table');
  }

  if (!/\bpublic\.ia_usage\b/i.test(uncommented)) {
    errors.push('095: expected uncommented SQL to use public.ia_usage');
  }

  // Deliberately requires the literal guard `consultas_count < v_limite` (optionally
  // alias-prefixed, e.g. `u.consultas_count < v_limite`) rather than any constant
  // threshold: a hardcoded large number (e.g. `< 999999999`) would satisfy a looser
  // "consultas_count < <anything>" pattern while reintroducing an unbounded/ineffective
  // guard, defeating the per-role daily limit this WHERE clause exists to enforce.
  const guardedUpsertPattern =
    /on\s+conflict\s*\([^)]*\)\s*do\s+update[\s\S]*?where[\s\S]*?\b(?:\w+\.)?consultas_count\s*<\s*v_limite\b[\s\S]*?returning/i;
  if (!guardedUpsertPattern.test(uncommented)) {
    errors.push(
      '095: expected an uncommented guarded INSERT .. ON CONFLICT DO UPDATE .. WHERE consultas_count < v_limite (not a hardcoded constant) .. RETURNING statement',
    );
  }
}

function sqlStatements(sql) {
  return stripSqlComments(sql)
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

function toClauseOf(statement) {
  const toIndex = statement.search(/\bto\b/i);
  return toIndex >= 0 ? statement.slice(toIndex) : '';
}

function grantedPublicRoles(statement) {
  const toClause = toClauseOf(statement);
  return PUBLIC_ROLES.filter(role => new RegExp(`\\b${role}\\b`, 'i').test(toClause));
}

function migrationNumber(name) {
  const match = /^(\d+)_/.exec(name);
  return match ? Number(match[1]) : null;
}

function checkMigration112(sql, errors) {
  const statements = sqlStatements(sql);
  for (const view of AGT003_COMMERCIAL_VIEWS) {
    const target = `public\\.${view}\\b`;
    for (const role of PUBLIC_ROLES) {
      const revoked = statements.some(
        statement =>
          new RegExp(`^revoke\\s+all\\s+on\\s+(table\\s+)?${target}`, 'i').test(statement) &&
          new RegExp(`\\b${role}\\b`, 'i').test(statement.slice(statement.search(/\bfrom\b/i))),
      );
      if (!revoked) errors.push(`112: expected uncommented SQL to revoke ALL on public.${view} from ${role}`);
    }
    const invoker = statements.some(statement =>
      new RegExp(`^alter\\s+view\\s+${target}\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*(true|on)\\s*\\)`, 'i').test(statement),
    );
    if (!invoker) errors.push(`112: expected uncommented SQL to set security_invoker = true on public.${view}`);
    const grants = statements.filter(statement => new RegExp(`^grant\\b[\\s\\S]*\\bon\\b[\\s\\S]*${target}`, 'i').test(statement));
    if (!grants.some(statement => /\bservice_role\b/i.test(toClauseOf(statement)))) {
      errors.push(`112: expected uncommented SQL to grant SELECT on public.${view} to service_role`);
    }
    for (const statement of grants) {
      for (const role of grantedPublicRoles(statement)) errors.push(`112: must not grant public.${view} to ${role}`);
    }
  }
}

// Migraciones posteriores a 112: no pueden volver a abrir las vistas ni quitarles security_invoker.
// `create or replace view` SIN `with (security_invoker = true)` borra la opción (los grants sí se conservan).
function checkLaterMigrationKeepsAgt003Views(name, sql, errors) {
  const statements = sqlStatements(sql);
  for (const statement of statements) {
    if (/^grant\b/i.test(statement) && /\bon\s+all\s+tables\s+in\s+schema\s+public\b/i.test(statement)) {
      for (const role of grantedPublicRoles(statement)) {
        errors.push(`${name}: must not grant ON ALL TABLES IN SCHEMA public to ${role} (would re-open the AGT-003 commercial views)`);
      }
    }
  }
  for (const view of AGT003_COMMERCIAL_VIEWS) {
    const target = `(public\\.)?"?${view}\\b"?`;
    const alterView = `^alter\\s+view\\s+(if\\s+exists\\s+)?${target}`;
    const setsInvoker = statement =>
      new RegExp(`${alterView}\\s+set\\s*\\([^)]*security_invoker\\s*(=\\s*(true|on)\\s*)?[,)]`, 'i').test(statement);
    for (const statement of statements) {
      if (/^grant\b/i.test(statement)) {
        const toIndex = statement.search(/\bto\b/i);
        const onClause = toIndex >= 0 ? statement.slice(0, toIndex) : statement;
        if (new RegExp(`\\bon\\b[\\s\\S]*${target}`, 'i').test(onClause)) {
          for (const role of grantedPublicRoles(statement)) errors.push(`${name}: must not grant public.${view} to ${role}`);
        }
      }
      const disablesInvoker =
        new RegExp(`${alterView}\\s+reset\\s*\\([^)]*security_invoker`, 'i').test(statement) ||
        new RegExp(`${alterView}\\s+set\\s*\\([^)]*security_invoker\\s*=\\s*(false|off)`, 'i').test(statement);
      if (disablesInvoker) errors.push(`${name}: must not reset or disable security_invoker on public.${view}`);
      if (new RegExp(`^create\\s+(or\\s+replace\\s+)?view\\s+${target}`, 'i').test(statement)) {
        const asIndex = statement.search(/\bas\b/i);
        const header = asIndex >= 0 ? statement.slice(0, asIndex) : statement;
        const withInvoker = /\bwith\s*\([^)]*security_invoker\s*(=\s*(true|on)\s*)?[,)]/i.test(header);
        if (!withInvoker && !statements.some(setsInvoker)) {
          errors.push(`${name}: recreating public.${view} must keep security_invoker (use WITH (security_invoker = true))`);
        }
      }
    }
  }
}

export function checkAgt003CommercialViewsFromMigrations(migrations) {
  const errors = [];
  const migration112 = migrations.filter(({ name }) => migrationNumber(name) === AGT003_VIEWS_MIGRATION_NUMBER
    && /commercial_views_no_public_access/.test(name));
  if (migration112.length !== 1) {
    errors.push('112: expected exactly one supabase/migrations/112_*commercial_views_no_public_access*.sql');
  } else {
    checkMigration112(migration112[0].sql, errors);
  }
  for (const { name, sql } of migrations) {
    const number = migrationNumber(name);
    if (number !== null && number > AGT003_VIEWS_MIGRATION_NUMBER) checkLaterMigrationKeepsAgt003Views(name, sql, errors);
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

export function checkAgt002GrantsStaticFromSql({ sql092, sql094, sql095 }) {
  const errors = [];

  checkMigration092(sql092, errors);
  checkMigration094(sql094, errors);
  if (sql095 !== undefined) {
    checkMigration095(sql095, errors);
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export async function checkAgt002GrantsStatic() {
  const migration092Sql = readFileSync(MIGRATION_092_PATH, 'utf8');
  const migration094Sql = readFileSync(MIGRATION_094_PATH, 'utf8');
  const migration095Sql = readFileSync(MIGRATION_095_PATH, 'utf8');

  const agt002 = checkAgt002GrantsStaticFromSql({
    sql092: migration092Sql,
    sql094: migration094Sql,
    sql095: migration095Sql,
  });
  const agt003Views = checkAgt003CommercialViewsFromMigrations(readMigrations());
  const errors = [...agt002.errors, ...agt003Views.errors];
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const result = await checkAgt002GrantsStatic();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
