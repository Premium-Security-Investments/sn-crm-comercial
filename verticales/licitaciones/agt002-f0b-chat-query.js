export const AGT002_F0B_SCHEMA_VERSION = 1;

export const AGT002_F0B_APPLY = false;

export const AGT002_F0B_INCIDENT_LANGUAGE =
  'sin evidencia de explotación y sin capacidad suficiente para descartarla retrospectivamente';

export const AGT002_F0B_ALLOWLIST = Object.freeze({});

const CHAT_QUERY_REVOKE_RE =
  /^revoke\s+(?:all|execute)\s+on\s+function\s+public\.chat_query\s*\(\s*text\s*\)\s+from\s+(.+)$/i;

export function parseChatQueryExecuteGrantees(routineGrants) {
  const grantees = new Set();
  for (const grant of routineGrants ?? []) {
    if (grant?.privilege_type === 'EXECUTE' && grant?.routine_name === 'chat_query') {
      grantees.add(grant.grantee);
    }
  }
  return grantees;
}

export function applyRevokeStatements(grantees, sql) {
  const remaining = new Set(grantees);
  const statements = sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const match = statement.match(CHAT_QUERY_REVOKE_RE);
    if (!match) continue;

    const roles = match[1]
      .split(',')
      .map(role => role.trim())
      .filter(Boolean);

    for (const role of roles) {
      const isPublic = /^public$/i.test(role);
      for (const existing of Array.from(remaining)) {
        if (isPublic ? /^public$/i.test(existing) : existing === role) {
          remaining.delete(existing);
        }
      }
    }
  }

  return remaining;
}

export function classifySecurityDefiner(routine) {
  const proname = routine?.proname;

  if (proname === 'chat_query') {
    return 'f0b_revoke_dynamic_sql';
  }
  if (proname === 'exec_sql') {
    return 'restricted_service_role_dynamic_sql_not_f0b';
  }

  const acl = routine?.acl ?? '';
  const isPublic = acl.startsWith('{=X/') || acl.includes(',=X/');
  const isAnon = acl.includes('anon=X');
  const isAuthenticated = acl.includes('authenticated=X');

  if (isPublic && isAnon && isAuthenticated) {
    return 'residual_public_anon_auth_predicate_f0e';
  }
  if (isAnon || isAuthenticated || isPublic) {
    return 'residual_anon_execute_f0e';
  }
  return 'restricted_owner_or_service_role';
}
