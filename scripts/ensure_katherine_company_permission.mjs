const TARGET_NAME = 'Katherine Valencia Buitrago';
const BASE_PERMISSION = 'licitaciones';
const COMPANY_PERMISSION = 'licitaciones_empresa';

export function normalizeHumanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-CO');
}

function isHuman(profile) {
  return profile?.active === true && (profile.identity_type == null || profile.identity_type === 'human');
}

function headers(serviceKey, prefer = null) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {}),
  };
}

async function requestJson(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed (${response.status}).`);
  return text ? JSON.parse(text) : null;
}

export async function ensureKatherineCompanyPermission({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.VERCEL_ENV !== 'production') return { status: 'skipped_non_production' };
  const baseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error('Production Supabase credentials are required.');

  const profileUrl = `${baseUrl}/rest/v1/psi_sales_profiles?select=id,full_name,identity_type,active&active=eq.true&full_name=ilike.*Katherine*`;
  const profiles = await requestJson(fetchImpl, profileUrl, { headers: headers(serviceKey) }, 'Profile lookup');
  const matches = (Array.isArray(profiles) ? profiles : []).filter(profile => isHuman(profile) && normalizeHumanName(profile.full_name) === normalizeHumanName(TARGET_NAME));
  if (matches.length !== 1) throw new Error(`Expected exactly one active human Katherine Valencia Buitrago profile; found ${matches.length}.`);
  const targetId = matches[0].id;

  const catalogUrl = `${baseUrl}/rest/v1/psi_access_permissions?select=code,active&code=eq.${BASE_PERMISSION}&active=eq.true`;
  const assignmentsUrl = `${baseUrl}/rest/v1/psi_profile_permissions?select=permission_code&profile_id=eq.${encodeURIComponent(targetId)}`;
  const [baseCatalog, assignments] = await Promise.all([
    requestJson(fetchImpl, catalogUrl, { headers: headers(serviceKey) }, 'Base permission lookup'),
    requestJson(fetchImpl, assignmentsUrl, { headers: headers(serviceKey) }, 'Assignment lookup'),
  ]);
  const currentPermissions = new Set((Array.isArray(assignments) ? assignments : []).map(row => row.permission_code));
  if (!Array.isArray(baseCatalog) || baseCatalog.length !== 1 || !currentPermissions.has(BASE_PERMISSION)) {
    throw new Error('Katherine Valencia Buitrago lacks active base permission licitaciones; no changes applied.');
  }

  const permissionUrl = `${baseUrl}/rest/v1/psi_access_permissions?on_conflict=code`;
  await requestJson(fetchImpl, permissionUrl, {
    method: 'POST',
    headers: headers(serviceKey, 'resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify({
      code: COMPANY_PERMISSION,
      name: 'Mantenimiento de información empresarial',
      description: 'Permite actualizar la ficha textual de la empresa para Licitaciones. No habilita documentos, custodia, conversión ni GO/NO GO.',
      active: true,
    }),
  }, 'Permission catalog upsert');

  if (currentPermissions.has(COMPANY_PERMISSION)) return { status: 'already_present' };

  const assignmentUrl = `${baseUrl}/rest/v1/psi_profile_permissions?on_conflict=profile_id,permission_code`;
  const inserted = await requestJson(fetchImpl, assignmentUrl, {
    method: 'POST',
    headers: headers(serviceKey, 'resolution=ignore-duplicates,return=representation'),
    body: JSON.stringify({ profile_id: targetId, permission_code: COMPANY_PERMISSION, created_by: null }),
  }, 'Permission assignment');
  if (!Array.isArray(inserted)) throw new Error('Permission assignment returned an invalid response.');
  if (inserted.length === 0) return { status: 'already_present' };
  if (inserted.length !== 1) throw new Error('Permission assignment affected an unexpected number of rows.');

  const auditUrl = `${baseUrl}/rest/v1/psi_access_audit_log`;
  try {
    await requestJson(fetchImpl, auditUrl, {
      method: 'POST',
      headers: headers(serviceKey, 'return=minimal'),
      body: JSON.stringify({
        actor_profile_id: null,
        target_profile_id: targetId,
        action: 'profile.permission.grant.deployment',
        before_state: { permissions: [...currentPermissions].sort() },
        after_state: { permissions: [...currentPermissions, COMPANY_PERMISSION].sort(), permission_code: COMPANY_PERMISSION, source: 'deployment_060' },
      }),
    }, 'Access audit insert');
  } catch (auditError) {
    const rollbackUrl = `${baseUrl}/rest/v1/psi_profile_permissions?profile_id=eq.${encodeURIComponent(targetId)}&permission_code=eq.${COMPANY_PERMISSION}`;
    try {
      await requestJson(fetchImpl, rollbackUrl, {
        method: 'DELETE',
        headers: headers(serviceKey, 'return=minimal'),
      }, 'Permission assignment compensation');
    } catch (rollbackError) {
      throw new AggregateError([auditError, rollbackError], 'Audit failed and permission compensation also failed.');
    }
    throw auditError;
  }

  return { status: 'granted' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureKatherineCompanyPermission()
    .then(result => console.log(`katherine_company_permission=${result.status}`))
    .catch(error => {
      console.error(`katherine_company_permission=failed: ${error.message}`);
      process.exitCode = 1;
    });
}
