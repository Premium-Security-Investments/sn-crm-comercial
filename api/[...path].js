import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import { callTenderOpportunityConversion, callTenderOpportunityDiscard, callTenderTrackingTransition, callTenderTrackingUpdate } from '../tender-tracking-rpc.js';
import { can, requireAction } from '../access-control.js';
import { ACTIONS } from '../access-control.js';
import { MODULE_PERMISSION_CODES, isModulePermissionEligible } from '../module-access.js';
import { VIGIA_CONFIG, prioritizeVigiaOpportunities } from '../vigia-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function sendError(res, error, status = 500) {
  console.error(error);
  res.status(status).json({ error: error?.message || String(error) });
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function requireDb() {
  if (!db) throw new Error('Server environment is missing Supabase credentials.');
  return db;
}


const managementRoles = ['director','gerencia','admin'];
const globalCrmScopeRoles = new Set(['gerencia', 'admin']);
const commercialAreas = ['seguridad_fisica','tecnologia','licitacion_publica'];
const customerSegments = ['cliente_nuevo','cliente_actual'];
function isManager(profile) { return managementRoles.includes(profile?.role); }
function validateCommercialArea(value) { const area = value || null; if (area && !commercialAreas.includes(area)) throw new Error('Área comercial no válida.'); return area; }
function validateCustomerSegment(value, required = false) { const segment = value || null; if (required && !segment) throw new Error('Debe clasificar la oportunidad como Cliente Nuevo o Cliente Actual.'); if (segment && !customerSegments.includes(segment)) throw new Error('Tipo de cliente no válido.'); return segment; }
function canEditCustomerSegment(profile, opportunity) { return globalCrmScopeRoles.has(profile?.role) || (profile?.can_edit_customer_segment && opportunity?.owner_id === profile.id); }
function canManageUsers(profile) { return profile?.role === 'admin'; }
export const MODULE_ENDPOINT_ACTIONS = Object.freeze({
  opportunities: ACTIONS.MODULE_OPPORTUNITIES_VIEW,
  goals: ACTIONS.MODULE_GOALS_VIEW,
  siio: ACTIONS.MODULE_SIIO_VIEW,
  vigia: ACTIONS.MODULE_VIGIA_VIEW,
  tenders: ACTIONS.LICITACIONES_VIEW,
  users: ACTIONS.MODULE_USERS_VIEW,
});
// Canonical and Vercel-safe aliases share one auditable method+route inventory.
export const HTTP_ACTION_MATRIX = Object.freeze({
  'GET /api/opportunities/:id': ['opportunities', ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW],
  'POST /api/opportunities': ['opportunities', ACTIONS.CRM_OPPORTUNITY_CREATE],
  'PUT /api/opportunities/:id': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT],
  'POST /api/opportunities/:id/interactions': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT],
  'GET /api/opportunity-detail': ['opportunities', ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW],
  'PUT /api/opportunity': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT],
  'POST /api/opportunity-interactions': ['opportunities', ACTIONS.CRM_OPPORTUNITY_EDIT],
  'GET /api/goals': ['goals', ACTIONS.MODULE_GOALS_VIEW],
  'PUT /api/goals': ['goals', ACTIONS.MODULE_GOALS_VIEW],
  'GET /api/vigia/priorities': ['vigia', ACTIONS.MODULE_VIGIA_VIEW],

  'GET /api/tenders': ['tenders', ACTIONS.LICITACIONES_VIEW],
  'GET /api/users': ['users', ACTIONS.USERS_MANAGE],
  'GET /api/access-catalog': ['users', ACTIONS.USERS_MANAGE],

  'GET /api/siio/bootstrap': ['siio', ACTIONS.SIIO_AREA_VIEW],
  'GET /api/siio/fronts': ['siio', ACTIONS.SIIO_AREA_VIEW],
  'GET /api/siio/records': ['siio', ACTIONS.SIIO_AREA_VIEW],
  'POST /api/siio/records': ['siio', ACTIONS.SIIO_SUBJECT_CREATE],
  'PATCH /api/siio/records/:id': ['siio', ACTIONS.SIIO_SUBJECT_EDIT],
  'GET /api/siio/sources': ['siio', ACTIONS.SIIO_AREA_VIEW],
  'POST /api/siio/sources': ['siio', ACTIONS.SIIO_SUBJECT_CREATE],
  'GET /api/siio/decisions': ['siio', ACTIONS.SIIO_AREA_VIEW],
  'POST /api/siio/decisions': ['siio', ACTIONS.SIIO_SUBJECT_CREATE],
  'PATCH /api/siio/decisions/:id': ['siio', ACTIONS.SIIO_SUBJECT_EDIT],
  'GET /api/siio/board-reports': ['siio', ACTIONS.BOARD_PUBLICATION_VIEW],
});
const SIIO_MANAGEMENT_RESOURCE = Object.freeze({ area_code: 'gerencia' });
const SIIO_PUBLISHED_BOARD_RESOURCE = Object.freeze({ publication_status: 'published' });
export const SIIO_ENDPOINT_ACTIONS = Object.freeze({
  'GET /api/siio/bootstrap': Object.freeze({ action: ACTIONS.SIIO_AREA_VIEW, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'board-published' }),
  'GET /api/siio/fronts': Object.freeze({ action: ACTIONS.SIIO_AREA_VIEW, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'GET /api/siio/records': Object.freeze({ action: ACTIONS.SIIO_AREA_VIEW, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'POST /api/siio/records': Object.freeze({ action: ACTIONS.SIIO_SUBJECT_CREATE, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'PATCH /api/siio/records/:id': Object.freeze({ action: ACTIONS.SIIO_SUBJECT_EDIT, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'GET /api/siio/sources': Object.freeze({ action: ACTIONS.SIIO_AREA_VIEW, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'POST /api/siio/sources': Object.freeze({ action: ACTIONS.SIIO_SUBJECT_CREATE, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'GET /api/siio/decisions': Object.freeze({ action: ACTIONS.SIIO_AREA_VIEW, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'POST /api/siio/decisions': Object.freeze({ action: ACTIONS.SIIO_SUBJECT_CREATE, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'PATCH /api/siio/decisions/:id': Object.freeze({ action: ACTIONS.SIIO_SUBJECT_EDIT, resource: SIIO_MANAGEMENT_RESOURCE, policy: 'management' }),
  'GET /api/siio/board-reports': Object.freeze({ action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: SIIO_PUBLISHED_BOARD_RESOURCE, policy: 'board-published' }),
});
export function requireModuleAction(profile, endpointModule) {
  return requireAction(profile, MODULE_ENDPOINT_ACTIONS[endpointModule], {});
}
function throwSiioForbidden() {
  const error = new Error('No tiene permisos para acceder al SIIO / F2 gerencial.');
  error.status = 403;
  error.code = 'FORBIDDEN';
  throw error;
}
export function requireSiioEndpointAccess(profile, methodRoute) {
  requireModuleAction(profile, 'siio');
  const endpoint = SIIO_ENDPOINT_ACTIONS[methodRoute];
  // SIIO rows have no canonical area/subarea relation yet, so directors fail
  // closed until Task 11 can derive a resource from the server-side record.
  if (!endpoint || profile?.role === 'director') throwSiioForbidden();
  if (profile?.role === 'junta') {
    if (endpoint.policy !== 'board-published') throwSiioForbidden();
    return requireAction(profile, ACTIONS.BOARD_PUBLICATION_VIEW, SIIO_PUBLISHED_BOARD_RESOURCE);
  }
  return requireAction(profile, endpoint.action, endpoint.resource);
}

function normalizeUserRole(value) {
  const raw = String(value || 'comercial').trim().toLowerCase();
  if (raw === 'directivo') return 'director';
  return raw;
}
function getBearerToken(req) {
  const raw = req.headers.authorization || '';
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
function isExactNonblankString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}
function normalizeAccessAssignments(rows) {
  if (!Array.isArray(rows)) throw new Error('Asignaciones de área inválidas.');
  const assignments = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !isExactNonblankString(row.area_code)
      || (row.subarea_code !== null && !isExactNonblankString(row.subarea_code))) {
      throw new Error('Asignaciones de área inválidas.');
    }
    const key = `${row.area_code}\u0000${row.subarea_code ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      assignments.push({ area_code: row.area_code, subarea_code: row.subarea_code });
    }
  }
  return assignments;
}
function normalizeAccessPermissions(rows) {
  if (!Array.isArray(rows)) throw new Error('Permisos inválidos.');
  const permissions = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isExactNonblankString(row.permission_code)) {
      throw new Error('Permisos inválidos.');
    }
    if (!seen.has(row.permission_code)) {
      seen.add(row.permission_code);
      permissions.push(row.permission_code);
    }
  }
  return permissions;
}

const PROFILE_ROLES = new Set(['admin','gerencia','director','comercial','colaborador','junta']);
const MODULE_PERMISSION_CODE_SET = new Set(MODULE_PERMISSION_CODES);
const MAX_PROFILE_ACCESS_ROWS = 100;
function accessValidationError(message) { const error = new Error(message); error.status = 400; return error; }
function profileAdministrationFailure(cause) {
  const error = new Error('No se pudo actualizar el perfil. Intente nuevamente.', { cause });
  error.status = 500;
  error.code = 'PROFILE_ADMIN_UPDATE_FAILED';
  return error;
}
function profileAdministrationConflict(cause) {
  const error = new Error('El perfil ya existe. Recargue la lista y edite el registro existente.', { cause });
  error.status = 409;
  error.code = 'PROFILE_ADMIN_CONFLICT';
  return error;
}
function normalizedProfileEmail(value) { return String(value || '').trim().toLowerCase(); }
export function assertNoAdminSelfLockout(currentProfile, { profileId, microsoftEmail, role, active, permissions }) {
  const sameProfile = Boolean(profileId && currentProfile?.id && profileId === currentProfile.id);
  const currentEmail = normalizedProfileEmail(currentProfile?.microsoft_email);
  const targetEmail = normalizedProfileEmail(microsoftEmail);
  const sameEmail = Boolean(currentEmail && targetEmail && currentEmail === targetEmail);
  const removesUsersModule = Array.isArray(permissions) && !permissions.includes('modulo_usuarios');
  if ((sameProfile || sameEmail) && (!active || role !== 'admin' || removesUsersModule)) throw accessValidationError('No puede desactivar, cambiar su propio rol de administrador ni retirarse Usuarios y Permisos.');
}
function catalogAccessFailure(cause) { const error = new Error('No se pudo validar el catálogo de acceso.', { cause }); error.status = 500; error.code = 'ACCESS_CATALOG_UNAVAILABLE'; return error; }
function profileAccessReadFailure(cause) { const error = new Error('No se pudo cargar la configuración de acceso.', { cause }); error.status = 500; error.code = 'PROFILE_ACCESS_READ_FAILED'; return error; }
function profileAccessWriteFailure(cause) { const error = new Error('No se pudo guardar el alcance de acceso. Intente nuevamente.', { cause }); error.status = 500; error.code = 'PROFILE_ACCESS_WRITE_FAILED'; return error; }
function validateAccessCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.areas) || !Array.isArray(catalog.subareas) || !Array.isArray(catalog.permissions)) throw new Error('Catálogo de acceso inválido.');
  for (const area of catalog.areas) if (!area || !isExactNonblankString(area.code) || !isExactNonblankString(area.name)) throw new Error('Catálogo de áreas inválido.');
  for (const subarea of catalog.subareas) if (!subarea || !isExactNonblankString(subarea.code) || !isExactNonblankString(subarea.area_code) || !isExactNonblankString(subarea.name)) throw new Error('Catálogo de subáreas inválido.');
  for (const permission of catalog.permissions) if (!permission || !isExactNonblankString(permission.code) || !isExactNonblankString(permission.name) || typeof permission.description !== 'string') throw new Error('Catálogo de permisos inválido.');
  return catalog;
}
export function normalizeProfileAccessRequest(body, catalog, role) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.areas)) throw accessValidationError('Debe enviar las áreas de alcance.');
  if (!Array.isArray(body.permissions)) throw accessValidationError('Debe enviar los permisos de acceso.');
  if (body.areas.length > MAX_PROFILE_ACCESS_ROWS || body.permissions.length > MAX_PROFILE_ACCESS_ROWS) throw accessValidationError(`Máximo ${MAX_PROFILE_ACCESS_ROWS} asignaciones o permisos.`);
  validateAccessCatalog(catalog);
  const areaCodes = new Set(catalog.areas.map(area => area.code));
  const subareasByCode = new Map(catalog.subareas.map(subarea => [subarea.code, subarea]));
  const permissionCodes = new Set(catalog.permissions.map(permission => permission.code));
  const areas = normalizeAccessAssignments(body.areas);
  const permissions = [];
  const seenPermissions = new Set();
  for (const permission of body.permissions) {
    if (!isExactNonblankString(permission) || !permissionCodes.has(permission)) throw accessValidationError('Permiso de acceso no válido.');
    if (!seenPermissions.has(permission)) { seenPermissions.add(permission); permissions.push(permission); }
  }
  for (const assignment of areas) {
    if (!areaCodes.has(assignment.area_code)) throw accessValidationError('Área de alcance no válida.');
    if (assignment.subarea_code !== null) {
      const subarea = subareasByCode.get(assignment.subarea_code);
      if (!subarea || subarea.area_code !== assignment.area_code) throw accessValidationError('Subárea de alcance no válida para el área seleccionada.');
    }
  }
  for (const assignment of areas) if (assignment.subarea_code === null && areas.some(other => other.area_code === assignment.area_code && other.subarea_code !== null)) throw accessValidationError('La asignación de área es ambigua: seleccione toda el área o sus subáreas.');
  for (const permission of permissions) {
    if (MODULE_PERMISSION_CODE_SET.has(permission) && !isModulePermissionEligible(role, permission)) {
      throw accessValidationError(`El módulo ${permission === 'licitaciones' ? 'Licitaciones' : 'seleccionado'} no aplica para este rol.`);
    }
  }
  return { areas, permissions };
}
export function legacyCommercialAreaFromAssignments(areas) {
  if (!Array.isArray(areas) || areas.length !== 1 || areas[0]?.area_code !== 'comercial') return null;
  return ({ seguridad_fisica: 'seguridad_fisica', tecnologia: 'tecnologia', licitaciones: 'licitacion_publica' })[areas[0].subarea_code] || null;
}
export function enrichProfilesWithAccess(profiles, assignmentRows, permissionRows) {
  if (!Array.isArray(profiles)) throw new Error('Perfiles inválidos.');
  if (!Array.isArray(assignmentRows)) throw new Error('Asignaciones inválidas.');
  if (!Array.isArray(permissionRows)) throw new Error('Permisos inválidos.');
  const profileIds = new Set();
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !isExactNonblankString(profile.id) || profileIds.has(profile.id)) throw new Error('Perfiles inválidos.');
    profileIds.add(profile.id);
  }
  const areasByProfile = new Map();
  for (const row of assignmentRows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isExactNonblankString(row.profile_id)) throw new Error('Asignaciones inválidas.');
    if (!profileIds.has(row.profile_id)) throw new Error('Asignación para perfil inesperado.');
    const rows = areasByProfile.get(row.profile_id) || [];
    rows.push(row);
    areasByProfile.set(row.profile_id, rows);
  }
  const permissionsByProfile = new Map();
  for (const row of permissionRows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isExactNonblankString(row.profile_id)) throw new Error('Permisos inválidos.');
    if (!profileIds.has(row.profile_id)) throw new Error('Permiso para perfil inesperado.');
    const rows = permissionsByProfile.get(row.profile_id) || [];
    rows.push(row);
    permissionsByProfile.set(row.profile_id, rows);
  }
  return profiles.map(profile => ({
    ...profile,
    areas: normalizeAccessAssignments(areasByProfile.get(profile.id) || []),
    permissions: normalizeAccessPermissions(permissionsByProfile.get(profile.id) || []),
  }));
}
async function getActiveAccessCatalog(database) {
  try {
    const [areas, subareas, permissions] = await Promise.all([
      must(database.from('psi_org_areas').select('code,name').eq('active', true).order('name').order('code')),
      must(database.from('psi_org_subareas').select('code,area_code,name').eq('active', true).order('area_code').order('name').order('code')),
      must(database.from('psi_access_permissions').select('code,name,description').eq('active', true).order('name').order('code')),
    ]);
    return validateAccessCatalog({ areas, subareas, permissions });
  } catch (error) { throw catalogAccessFailure(error); }
}
async function readProfileAccess(database, profileId) {
  try {
    const [areaRows, permissionRows] = await Promise.all([
      must(database.from('psi_profile_area_assignments').select('area_code,subarea_code,created_by').eq('profile_id', profileId)),
      must(database.from('psi_profile_permissions').select('permission_code,created_by').eq('profile_id', profileId)),
    ]);
    return { areas: normalizeAccessAssignments(areaRows), permissions: normalizeAccessPermissions(permissionRows), areaRows, permissionRows };
  } catch (error) { throw profileAccessWriteFailure(error); }
}
export async function replaceProfileAccess(database, { profileId, actorProfileId, before, after }) {
  try {
    // Supabase REST has no shared transaction here. If a later write fails we best-effort restore the exact old rows.
    await must(database.from('psi_profile_area_assignments').delete().eq('profile_id', profileId));
    await must(database.from('psi_profile_permissions').delete().eq('profile_id', profileId));
    if (after.areas.length) await must(database.from('psi_profile_area_assignments').insert(after.areas.map(area => ({ ...area, profile_id: profileId, created_by: actorProfileId }))));
    if (after.permissions.length) await must(database.from('psi_profile_permissions').insert(after.permissions.map(permission_code => ({ permission_code, profile_id: profileId, created_by: actorProfileId }))));
    await must(database.from('psi_access_audit_log').insert({ actor_profile_id: actorProfileId, target_profile_id: profileId, action: 'profile.access.replace', before_state: { areas: before.areas, permissions: before.permissions }, after_state: after }));
  } catch (error) {
    console.error('Profile access write failed; attempting compensation restore', error);
    try {
      await must(database.from('psi_profile_area_assignments').delete().eq('profile_id', profileId));
      await must(database.from('psi_profile_permissions').delete().eq('profile_id', profileId));
      if (before.areaRows.length) await must(database.from('psi_profile_area_assignments').insert(before.areaRows.map(({ area_code, subarea_code, created_by }) => ({ profile_id: profileId, area_code, subarea_code, created_by }))));
      if (before.permissionRows.length) await must(database.from('psi_profile_permissions').insert(before.permissionRows.map(({ permission_code, created_by }) => ({ profile_id: profileId, permission_code, created_by }))));
    } catch (restoreError) { console.error('Profile access compensation restore failed', restoreError); }
    throw profileAccessWriteFailure(error);
  }
}
const profileAdminSelect = 'id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment,created_at';
function profileExpectedSnapshot(profile) {
  return {
    id: profile.id,
    full_name: profile.full_name,
    microsoft_email: profile.microsoft_email,
    role: profile.role,
    active: profile.active,
    commercial_area: profile.commercial_area ?? null,
    can_edit_customer_segment: profile.can_edit_customer_segment === true,
  };
}
export async function acquireProfileAdministrationLock(database, actorProfileId) {
  try {
    const operationId = await must(database.rpc('psi_admin_acquire_profile_lock', { p_actor_profile_id: actorProfileId }));
    if (!isExactNonblankString(operationId)) throw new Error('Lock de administración inválido.');
    return operationId;
  } catch (error) {
    if (error?.code === '55P03' || error?.code === '23505') {
      const busy = new Error('Otra administración de perfiles está en curso. Intente nuevamente en unos segundos.', { cause: error });
      busy.status = 409;
      busy.code = 'PROFILE_ADMIN_BUSY';
      throw busy;
    }
    throw profileAdministrationFailure(error);
  }
}
export async function releaseProfileAdministrationLock(database, operationId, actorProfileId) {
  if (!operationId) return;
  try {
    await must(database.rpc('psi_admin_release_profile_lock', { p_operation_id: operationId, p_actor_profile_id: actorProfileId }));
  } catch (error) { console.error('Could not release profile administration lock; lease will expire', error); }
}
export async function persistProfileAccessChange(database, { mode, targetId, beforeProfile, profileValues, afterAccess, actorProfileId, operationId }) {
  try {
    const row = await must(database.rpc('psi_admin_persist_profile_access', {
      p_mode: mode,
      p_target_id: beforeProfile?.id || targetId || null,
      p_expected_profile: beforeProfile ? profileExpectedSnapshot(beforeProfile) : null,
      p_profile: profileValues,
      p_areas: afterAccess.areas,
      p_permissions: afterAccess.permissions,
      p_actor_profile_id: actorProfileId,
      p_operation_id: operationId,
    }));
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isExactNonblankString(row.id)) throw new Error('Respuesta transaccional de perfil inválida.');
    return row;
  } catch (error) {
    if (error?.code === '23505') throw profileAdministrationConflict(error);
    if (error?.code === '40001') {
      const stale = new Error('El perfil cambió mientras se guardaba. Recargue y vuelva a intentar.', { cause: error });
      stale.status = 409;
      stale.code = 'PROFILE_ADMIN_STALE';
      throw stale;
    }
    if (error?.code === '55P03') {
      const busy = new Error('La operación de administración expiró o perdió el lock. Recargue y vuelva a intentar.', { cause: error });
      busy.status = 409;
      busy.code = 'PROFILE_ADMIN_BUSY';
      throw busy;
    }
    throw profileAdministrationFailure(error);
  }
}
function authContextUnavailable(cause) {
  const error = new Error('No se pudo validar el acceso del usuario.', { cause });
  error.status = 500;
  error.code = 'AUTH_CONTEXT_UNAVAILABLE';
  return error;
}
export async function getAuthContext(req) {
  const database = requireDb();
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Debe iniciar sesión.');
    error.status = 401;
    throw error;
  }
  const { data: userData, error: userError } = await database.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    const error = new Error('Sesión inválida o vencida.');
    error.status = 401;
    throw error;
  }
  let profile;
  try {
    profile = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,auth_user_id,role,active,commercial_area,can_edit_customer_segment').eq('auth_user_id', userData.user.id).maybeSingle());
  } catch (error) {
    throw authContextUnavailable(error);
  }
  if (!profile || profile.active !== true) {
    const error = new Error('El usuario no tiene perfil comercial activo.');
    error.status = 403;
    throw error;
  }
  const { auth_user_id: _internalAuthUserId, ...authorizedProfile } = profile;
  // Access scope is server-derived from trusted profile assignment tables.
  try {
    const [assignmentsResult, permissionsResult] = await Promise.all([
      database.from('psi_profile_area_assignments').select('area_code,subarea_code').eq('profile_id', profile.id),
      database.from('psi_profile_permissions').select('permission_code').eq('profile_id', profile.id)
    ]);
    if (assignmentsResult.error) throw assignmentsResult.error;
    if (permissionsResult.error) throw permissionsResult.error;
    const areas = normalizeAccessAssignments(assignmentsResult.data);
    const permissions = normalizeAccessPermissions(permissionsResult.data);
    return { user: userData.user, profile: { ...authorizedProfile, areas, permissions }, token };
  } catch (error) {
    throw authContextUnavailable(error);
  }
}
function sendAuthError(res, error) {
  sendError(res, error, error?.status || 500);
}
function getPublicAppUrl(req) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && String(host).includes('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : 'https://seguridad-nacional-crm.vercel.app';
}
function recomputeSummary(stages, opportunities) {
  return stages.map(stage => {
    const rows = opportunities.filter(o => o.stage_code === stage.code);
    return {
      stage_code: stage.code,
      stage_name: stage.name,
      stage_order: stage.stage_order,
      opportunities_count: rows.length,
      total_offer_value: rows.reduce((sum, o) => sum + Number(o.offer_value || 0), 0),
      weighted_pipeline_value: rows.reduce((sum, o) => sum + Number(o.weighted_pipeline_value || 0), 0)
    };
  });
}
export function bootstrapCapabilities(profile) {
  return Object.freeze({
    opportunities: can(profile, ACTIONS.MODULE_OPPORTUNITIES_VIEW),
    goals: can(profile, ACTIONS.MODULE_GOALS_VIEW),
    dashboard: can(profile, ACTIONS.MODULE_DASHBOARD_VIEW),
    alerts: can(profile, ACTIONS.MODULE_ALERTS_VIEW),
    vigia: can(profile, ACTIONS.MODULE_VIGIA_VIEW),
  });
}
const BOOTSTRAP_PROFILE_SELECT = 'id,full_name';
function crmResource(ownerId, assignment = {}) {
  return { area_code: assignment.area_code || 'comercial', subarea_code: assignment.subarea_code ?? null, owner_id: ownerId };
}
function assignmentsByProfile(rows = []) {
  const result = new Map();
  for (const row of rows) {
    if (!row?.profile_id || row.area_code !== 'comercial') continue;
    const assignments = result.get(row.profile_id) || [];
    assignments.push({ area_code: row.area_code, subarea_code: row.subarea_code ?? null });
    result.set(row.profile_id, assignments);
  }
  return result;
}
function canReadCrmRow(profile, row, ownerAssignments) {
  const ownerId = row?.owner_id;
  const assignments = ownerAssignments.get(ownerId) || [];
  if (assignments.some(assignment => can(profile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, crmResource(ownerId, assignment)))) return true;
  // Commercial ownership is already enforced by the action, while directors must
  // always match a canonical assignment from the server.
  return profile?.role !== 'director' && can(profile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, crmResource(ownerId));
}
function readableOwnerIds(profile, profiles, ownerAssignments, globalScope) {
  if (globalScope) return new Set(profiles.map(profileRow => profileRow.id));
  const ids = new Set([profile.id]);
  for (const profileRow of profiles) {
    if (canReadCrmRow(profile, { owner_id: profileRow.id }, ownerAssignments)) ids.add(profileRow.id);
  }
  return ids;
}
export function filterBootstrapForProfile(payload, currentProfile) {
  const { profileAssignments = [], ...publicPayload } = payload;
  const capabilities = bootstrapCapabilities(currentProfile);
  const globalScope = globalCrmScopeRoles.has(currentProfile?.role);
  const ownerAssignments = assignmentsByProfile(profileAssignments);
  const visibleOwnerIds = readableOwnerIds(currentProfile, payload.profiles, ownerAssignments, globalScope);
  const commercialData = capabilities.opportunities || capabilities.dashboard || capabilities.alerts || capabilities.vigia;
  const scopedOpportunities = globalScope ? payload.opportunities : payload.opportunities.filter(o => canReadCrmRow(currentProfile, o, ownerAssignments));
  const scopedStalled = globalScope ? payload.stalled : payload.stalled.filter(o => canReadCrmRow(currentProfile, o, ownerAssignments));
  const scopedTopClosing = globalScope ? payload.topClosing : payload.topClosing.filter(o => canReadCrmRow(currentProfile, o, ownerAssignments));
  const scopedMonthlyKpis = globalScope ? payload.monthlyKpis : payload.monthlyKpis.filter(k => visibleOwnerIds.has(k.owner_id));
  const scopedGoals = globalScope ? payload.goals : payload.goals.filter(g => !g.user_id || visibleOwnerIds.has(g.user_id));
  const needsProfiles = commercialData || capabilities.goals;
  const opportunities = commercialData ? scopedOpportunities : [];
  const stages = commercialData ? payload.stages : [];
  const services = commercialData || capabilities.goals ? payload.services : [];
  const lossReasons = capabilities.opportunities ? payload.lossReasons : [];
  const summary = capabilities.dashboard || capabilities.vigia
    ? (globalScope ? payload.summary : recomputeSummary(stages, opportunities))
    : [];
  const stalled = capabilities.dashboard ? scopedStalled : [];
  const topClosing = capabilities.dashboard ? scopedTopClosing : [];
  const monthlyKpis = capabilities.goals || capabilities.dashboard || capabilities.alerts || capabilities.vigia ? scopedMonthlyKpis : [];
  const goals = capabilities.goals || capabilities.dashboard || capabilities.alerts || capabilities.vigia ? scopedGoals : [];
  const profiles = (needsProfiles
    ? (globalScope ? payload.profiles : payload.profiles.filter(p => visibleOwnerIds.has(p.id)))
    : []).map(({ id, full_name }) => ({ id, full_name }));
  const totals = opportunities.reduce((acc, o) => {
    acc.count += 1;
    acc.pipeline += Number(o.offer_value || 0);
    acc.weighted += Number(o.weighted_pipeline_value || 0);
    if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
    return acc;
  }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
  return { ...publicPayload, summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals, totals: capabilities.dashboard || capabilities.vigia ? totals : { count: 0, pipeline: 0, weighted: 0, approved: 0 }, currentProfile };
}
function opportunityOwnerError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
async function resolveActiveOpportunityOwner(database, ownerId) {
  if (!ownerId) throw opportunityOwnerError('El comercial responsable es obligatorio.', 400);
  const { data: owner, error } = await database.from('psi_sales_profiles').select('id,active').eq('id', ownerId).single();
  if (error) {
    if (error.code === 'PGRST116') throw opportunityOwnerError('El comercial responsable no existe.', 404);
    throw error;
  }
  if (!owner) throw opportunityOwnerError('El comercial responsable no existe.', 404);
  if (!owner.active) throw opportunityOwnerError('El comercial responsable debe estar activo.', 400);
  return owner;
}
async function requireExistingOpportunityAction(database, profile, ownerId, action) {
  const assignments = await must(database.from('psi_profile_area_assignments').select('area_code,subarea_code').eq('profile_id', ownerId));
  if (assignments.some(assignment => can(profile, action, crmResource(ownerId, assignment)))) return true;
  return requireAction(profile, action, crmResource(ownerId));
}
export async function requireOpportunityAction(database, profile, ownerId, action) {
  const owner = await resolveActiveOpportunityOwner(database, ownerId);
  return requireExistingOpportunityAction(database, profile, owner.id, action);
}
async function ensureOpportunityAccess(database, id, profile, action = ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW) {
  const opportunity = await must(database.from('psi_sales_opportunities').select('id,owner_id,customer_segment').eq('id', id).single());
  await requireExistingOpportunityAction(database, profile, opportunity.owner_id, action);
  return opportunity;
}

const opportunitySelect = '*';
const VIGIA_OPPORTUNITY_SELECT = 'id,owner_id,owner_name,company_name,stage_code,stage_name,stage_order,service_type_code,service_type_name,regional_nombre,offer_value,weighted_pipeline_value,next_action_at,last_interaction_at,updated_at,created_at,expected_close_date';
async function attachCommercialMetadata(database, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return rows;
  const ids = list.map(o => o?.id).filter(Boolean);
  const ownerIds = Array.from(new Set(list.map(o => o?.owner_id).filter(Boolean)));
  const [baseResult, profileResult] = await Promise.all([
    ids.length ? database.from('psi_sales_opportunities').select('id,customer_segment').in('id', ids) : Promise.resolve({ data: [] }),
    ownerIds.length ? database.from('psi_sales_profiles').select('id,commercial_area,can_edit_customer_segment').in('id', ownerIds) : Promise.resolve({ data: [] })
  ]);
  if (baseResult.error) throw baseResult.error;
  if (profileResult.error) throw profileResult.error;
  const segmentById = new Map((baseResult.data || []).map(o => [o.id, o.customer_segment || null]));
  const profileById = new Map((profileResult.data || []).map(p => [p.id, p]));
  const enriched = list.map(o => {
    const owner = profileById.get(o.owner_id);
    return { ...o, customer_segment: segmentById.get(o.id) ?? o.customer_segment ?? null, owner_commercial_area: owner?.commercial_area || null, owner_can_edit_customer_segment: !!owner?.can_edit_customer_segment };
  });
  return Array.isArray(rows) ? enriched : enriched[0];
}
async function logCustomerSegmentChange(database, opportunityId, actorId, oldValue, newValue) {
  if ((oldValue || null) === (newValue || null)) return;
  await database.from('psi_sales_opportunity_audit_logs').insert({ opportunity_id: opportunityId, changed_by: actorId, field_name: 'customer_segment', old_value: oldValue || null, new_value: newValue || null, notes: 'Cambio de Cliente Nuevo / Cliente Actual' });
}



const tenderSources = {
  'SECOP II': {
    base: 'https://www.datos.gov.co/resource/p6dx-8zbt.json',
    dateField: 'fecha_de_publicacion_del',
    select: 'entidad,departamento_entidad,ciudad_entidad,id_del_proceso,referencia_del_proceso,nombre_del_procedimiento,descripci_n_del_procedimiento,fase,estado_del_procedimiento,fecha_de_publicacion_del,fecha_de_recepcion_de,precio_base,codigo_principal_de_categoria,urlproceso',
    nameFields: ['nombre_del_procedimiento','descripci_n_del_procedimiento']
  },
  'SECOP I': {
    base: 'https://www.datos.gov.co/resource/f789-7hwg.json',
    dateField: 'fecha_de_cargue_en_el_secop',
    select: 'nombre_entidad,departamento_entidad,municipio_entidad,numero_de_proceso,objeto_a_contratar,detalle_del_objeto_a_contratar,estado_del_proceso,fecha_de_cargue_en_el_secop,cuantia_proceso,ruta_proceso_en_secop_i',
    nameFields: ['objeto_a_contratar','detalle_del_objeto_a_contratar']
  }
};
const SECOP_PROCESSES_RESOURCE = 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
const SECOP_DOCUMENTS_RESOURCE = 'https://www.datos.gov.co/resource/dmgg-8hin.json';
const TVEC_EVENTS_URL = 'https://operaciones.colombiacompra.gov.co/eventos-cotizacion-tvec';
const ESU_CONTRATACION_ORIGIN = 'https://esucontratacion.com';
const ESU_CONTRATACION_URL = `${ESU_CONTRATACION_ORIGIN}/procesos/index`;
const ESU_RELEVANT_CATEGORY_IDS = { '7': 'Tecnología', '8': 'Sistemas integrales de seguridad', '9': 'Vigilancia física' };
const ESU_RELEVANT_KEYWORDS = ['vigilancia', 'seguridad', 'cctv', 'videovigilancia', 'control de acceso', 'alarma'];
const ESU_DATOS_GOV_ENTITY_TERMS = ['EMPRESA PARA LA SEGURIDAD URBANA', 'EMPRESA PARA LA SEGURIDAD Y SOLUCIONES URBANAS'];
const TVEC_RELEVANT_AGGREGATIONS = {
  'Soluciones de videovigilancia': 90,
  'Soluciones de Videovigilancia y sus mantenimientos II': 90,
  'Video-vigilancia ciudadana': 90,
  'Video Vigilancia': 85,
  'Conectividad IV': 45,
  'IAD Software por Catalogo II': 38,
  'IAD Software por Catálogo II': 38,
  'Nube pública V': 35,
  'Nube Privada IV': 35,
  'Productos y Servicios Electrónicos y Digitales de Confianza': 32
};
const tenderPositiveTerms = {
  'vigilancia y seguridad privada': 45, 'vigilancia y seguridad': 42, 'servicios de vigilancia': 40, 'servicio de vigilancia': 40,
  'vigilancia armada': 38, 'vigilancia privada': 38, 'vigilancia': 35,
  'seguridad privada': 35, 'seguridad electronica': 35, 'seguridad electrónica': 35, 'cctv': 35,
  'videovigilancia': 35, 'video vigilancia': 35, 'control de acceso': 30, 'biometrico': 22, 'biométrico': 22,
  'alarma': 22, 'monitoreo': 22, 'circuito cerrado': 30, 'guardas': 28, 'cedi': 20, 'bodega': 10
};
const tenderDisqualifyingTerms = [
  'interventoria', 'interventoría',
  'vehiculo blindado', 'vehículo blindado', 'vehiculos blindados', 'vehículos blindados',
  'transporte blindado', 'camioneta blindada', 'camionetas blindadas', 'carro blindado',
  'blindaje vehicular', 'blindaje de vehiculos', 'blindaje de vehículos', 'blindados',
  // Regla de descarte SN/PSI: no somos empresa de mantenimiento/soporte técnico de equipos.
  'soporte y mantenimiento', 'mantenimiento y soporte', 'mantenimiento preventivo', 'mantenimiento correctivo',
  'soporte tecnico', 'soporte técnico', 'mesa de ayuda', 'repuestos', 'calibracion', 'calibración',
  'radiocomunicaciones', 'radiocomunicacion', 'radio comunicaciones', 'radio comunicación',
  'sistema de radiocomunicaciones', 'equipos de comunicacion', 'equipos de comunicación',
  'red de comunicaciones', 'telecomunicaciones'
];
const tenderFocusTerms = { 'bogotá': 22, 'bogota': 22, 'distrito capital': 20, 'medellín': 22, 'medellin': 22, 'antioquia': 14 };
const tenderInternalStatuses = ['nueva','en_revision','descartada','convertida_oportunidad'];
export function canViewTenders(profile) { return can(profile, ACTIONS.LICITACIONES_VIEW); }
const tenderRegionKeys = ['todas','bog_cundinamarca','med_antioquia','eje_cafetero','cali_valle','costa_caribe','santanderes','sur_occidente','otros'];
const tenderSectionFilters = ['todas','hacer','revisar','descartar'];
const tenderDeadlineFilters = ['todas','0_7','8_15','16_30','vencida','sin_fecha'];
const tenderValueFilters = ['todas','sin_valor','lt_50m','50m_500m','500m_plus','1000m_plus'];
const tenderScoreFilters = ['todas','alto','medio','bajo'];
function pickTenderFilter(value, allowed, fallback = 'todas') { const clean = String(value || fallback).trim(); return allowed.includes(clean) ? clean : fallback; }
function cleanTenderSearchProfile(body, profile) {
  const name = String(body?.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Debe indicar un nombre para el perfil de búsqueda.');
  return {
    name,
    description: String(body?.description || '').trim().slice(0, 500) || null,
    region_key: pickTenderFilter(body?.region_key, tenderRegionKeys),
    source_filter: String(body?.source_filter || 'todas').trim().slice(0, 120) || 'todas',
    section_filter: pickTenderFilter(body?.section_filter, tenderSectionFilters),
    internal_status_filter: pickTenderFilter(body?.internal_status_filter, ['todas', ...tenderInternalStatuses]),
    deadline_filter: pickTenderFilter(body?.deadline_filter, tenderDeadlineFilters),
    value_filter: pickTenderFilter(body?.value_filter, tenderValueFilters),
    score_filter: pickTenderFilter(body?.score_filter, tenderScoreFilters),
    query_text: String(body?.query_text || '').trim().slice(0, 250) || null,
    is_default: Boolean(body?.is_default),
    updated_by: profile.id,
  };
}
function isMissingTenderSearchProfilesTable(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return msg.includes('42p01') || msg.includes('psi_tender_search_profiles');
}
async function tenderSearchProfilesTableAvailable(database) {
  const { error } = await database.from('psi_tender_search_profiles').select('id').limit(1);
  if (!error) return true;
  if (isMissingTenderSearchProfilesTable(error)) return false;
  throw error;
}
async function listTenderSearchProfiles(database) {
  if (!(await tenderSearchProfilesTableAvailable(database))) return [];
  const { data, error } = await database.from('psi_tender_search_profiles').select('*').order('is_default', { ascending: false }).order('name');
  if (error) throw error;
  return data || [];
}
async function saveTenderSearchProfile(database, body, profile) {
  if (!(await tenderSearchProfilesTableAvailable(database))) throw new Error('La tabla psi_tender_search_profiles aún no existe. Aplica la migración 013 para guardar perfiles de búsqueda.');
  const payload = { ...cleanTenderSearchProfile(body, profile), created_by: profile.id };
  const { data, error } = await database.from('psi_tender_search_profiles').upsert(payload, { onConflict: 'name', defaultToNull: false }).select('*').single();
  if (error) throw error;
  return data;
}
async function deleteTenderSearchProfile(database, id) {
  if (!(await tenderSearchProfilesTableAvailable(database))) throw new Error('La tabla psi_tender_search_profiles aún no existe.');
  const { error } = await database.from('psi_tender_search_profiles').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}
const tenderCompanyProfileFields = ['legal_name','nit','rup_status','rup_updated_at','rup_unspsc_codes','authorized_services','supervigilancia_license','financial_capacity','organizational_capacity','experience_summary','certifications','recurring_documents','disqualifications_notes','useful_company_info','source_document_name','rup_import_notes'];
function cleanTenderCompanyProfile(body, profile) {
  const payload = { singleton_key: 'seguridad_nacional', updated_by: profile.id };
  for (const field of tenderCompanyProfileFields) {
    const value = body?.[field];
    payload[field] = value === undefined || value === null ? null : String(value).trim() || null;
  }
  if (payload.rup_updated_at && !/^\d{4}-\d{2}-\d{2}$/.test(payload.rup_updated_at)) payload.rup_updated_at = null;
  return payload;
}
function firstRupMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim().slice(0, 1200);
  }
  return null;
}
function uniqueLinesFromMatches(text, regex, limit = 30) {
  const found = new Set();
  for (const match of text.matchAll(regex)) {
    const value = String(match[0] || match[1] || '').replace(/\s+/g, ' ').trim();
    if (value) found.add(value.slice(0, 220));
    if (found.size >= limit) break;
  }
  return [...found].join('\n') || null;
}
function parseRupCompanyProfile(extractedText, existing = {}, sourceDocumentName = '') {
  const text = String(extractedText || '').replace(/\r/g, '\n');
  const compact = text.replace(/\s+/g, ' ');
  const payload = { ...existing, source_document_name: sourceDocumentName || existing.source_document_name || null };
  payload.legal_name = firstRupMatch(compact, [/Raz[oó]n social\s*[:\-]?\s*([^\n]{5,160}?)(?:\s+NIT|\s+Identificaci[oó]n|\s+C[áa]mara|$)/i, /Nombre\s*[:\-]?\s*([^\n]{5,160}?)(?:\s+NIT|\s+Identificaci[oó]n|$)/i]) || payload.legal_name || null;
  payload.nit = firstRupMatch(compact, [/(?:NIT|Identificaci[oó]n)\s*[:\-]?\s*([0-9][0-9.\- ]{7,20})/i]) || payload.nit || null;
  const date = firstRupMatch(compact, [/(?:Fecha\s+de\s+(?:expedici[oó]n|renovaci[oó]n|actualizaci[oó]n|inscripci[oó]n))\s*[:\-]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i]);
  if (date) {
    const parts = date.replace(/\//g, '-').split('-');
    payload.rup_updated_at = parts[0].length === 4 ? `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}` : `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  payload.rup_status = firstRupMatch(compact, [/(?:Estado\s+del\s+proponente|Estado\s+RUP|Estado)\s*[:\-]?\s*([^\n]{4,120}?)(?:\s+Fecha|\s+Clasificaci[oó]n|$)/i]) || payload.rup_status || 'Información extraída de RUP cargado; validar vigencia/firmeza.';
  payload.rup_unspsc_codes = uniqueLinesFromMatches(text, /\b\d{8}\b[^\n]{0,180}/g, 80) || payload.rup_unspsc_codes || null;
  payload.financial_capacity = firstRupMatch(compact, [/(Capacidad\s+financiera.{0,2200}?)(?:Capacidad\s+organizacional|Experiencia|Clasificaci[oó]n|$)/i]) || payload.financial_capacity || null;
  payload.organizational_capacity = firstRupMatch(compact, [/(Capacidad\s+organizacional.{0,1800}?)(?:Experiencia|Clasificaci[oó]n|Contratos|$)/i]) || payload.organizational_capacity || null;
  payload.experience_summary = firstRupMatch(compact, [/(Experiencia.{0,2600}?)(?:Capacidad\s+financiera|Capacidad\s+organizacional|Clasificaci[oó]n|$)/i]) || payload.experience_summary || null;
  const detected = tenderCompanyProfileFields.filter(field => !['source_document_name','rup_import_notes'].includes(field) && String(payload[field] || '').trim()).length;
  const snippet = compact.slice(0, 2500);
  payload.rup_import_notes = [
    `Documento RUP procesado: ${sourceDocumentName || 'archivo cargado'}`,
    `Caracteres de texto extraídos: ${compact.length}`,
    `Campos con información después de importar: ${detected}`,
    compact.length < 80 ? 'Advertencia: el archivo parece escaneado o sin texto seleccionable; cargue un PDF de texto/DOCX para extracción automática.' : 'Texto extraído del RUP disponible para validar y completar manualmente.'
  ].join('\n');
  payload.useful_company_info = [`RUP cargado para análisis de licitaciones (${new Date().toISOString().slice(0,10)}).`, payload.useful_company_info || '', snippet ? `Texto extraído del RUP:\n${snippet}` : 'No se obtuvo texto útil del RUP; validar manualmente con el documento fuente.'].filter(Boolean).join('\n\n');
  return payload;
}
async function getTenderCompanyProfile(database) {
  const { data, error } = await database.from('psi_company_procurement_profile').select('*').eq('singleton_key', 'seguridad_nacional').maybeSingle();
  if (!error && data) return await attachTenderCompanyProfileUpdater(database, data, data.updated_at, data.updated_by);
  if (error && !['PGRST205','42P01'].includes(error.code)) throw error;
  const fallback = await database.from('psi_tender_radar_runs').select('summary,run_at,triggered_by').eq('mode', 'company_profile').order('run_at', { ascending: false }).limit(1).maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data?.summary) return {};
  let parsed = {};
  try { parsed = JSON.parse(fallback.data.summary); } catch { parsed = { useful_company_info: fallback.data.summary }; }
  return await attachTenderCompanyProfileUpdater(database, parsed, fallback.data.run_at, fallback.data.triggered_by);
}
async function attachTenderCompanyProfileUpdater(database, data, updatedAt, updatedBy) {
  let updatedByName = null;
  if (updatedBy) {
    const result = await database.from('psi_sales_profiles').select('full_name').eq('id', updatedBy).maybeSingle();
    updatedByName = result.data?.full_name || null;
  }
  return { ...data, updated_at: data.updated_at || updatedAt || null, updated_by_name: updatedByName };
}
async function saveTenderCompanyProfile(database, payload) {
  const result = await database.from('psi_company_procurement_profile').upsert(payload, { onConflict: 'singleton_key' }).select('id').single();
  if (!result.error) return;
  if (!['PGRST205','42P01'].includes(result.error.code)) throw result.error;
  const fallbackPayload = { ...payload };
  delete fallbackPayload.singleton_key;
  delete fallbackPayload.updated_by;
  await must(database.from('psi_tender_radar_runs').insert({ triggered_by: payload.updated_by, mode: 'company_profile', summary: JSON.stringify(fallbackPayload) }).select('id').single());
}
function normTenderText(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
const tenderTerminalStatusTerms = ['revocado', 'declarado desierto', 'desierto', 'cancelado', 'cancelada'];
function isTenderTerminalStatus(value) {
  const text = normTenderText(value);
  return tenderTerminalStatusTerms.some(term => text.includes(normTenderText(term)));
}
function tenderStatusSearchText(item) {
  const raw = item?.raw || item || {};
  return [
    item?.status, raw.fase, raw.estado_del_procedimiento, raw.estado_del_proceso, raw.estado,
    raw.descripcion_estado, raw.estado_resumen, raw.resultado, raw.comentario_entidad_estatal
  ].filter(Boolean).join(' ');
}
function isTenderTrackable(item) {
  const text = tenderText(item?.raw || item || {});
  return !isTenderTerminalStatus(tenderStatusSearchText(item)) && !tenderDisqualifyingTerms.some(term => text.includes(normTenderText(term)));
}
function tenderMoney(value) { const n = Number(String(value || '0').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function tenderDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function tenderDaysUntil(value) { const d = tenderDate(value); if (!d) return null; const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.round((d.getTime() - today.getTime()) / 86400000); }
function tenderWindow(days) { if (days === null) return 'sin fecha de cierre reportada'; if (days <= 7) return 'urgente (0-7 días)'; if (days <= 15) return 'revisar rápido (8-15 días)'; if (days <= 30) return 'buena ventana (16-30 días)'; return 'ventana amplia'; }
function tenderText(row) { return normTenderText(Object.values(row || {}).filter(v => typeof v === 'string').join(' ')); }
function stableTenderKey(tender) {
  const base = [tender.source, tender.process_id || tender.ref, tender.entity, tender.title].map(v => normTenderText(v)).join('|');
  return createHash('sha1').update(base).digest('hex').slice(0, 20);
}
const tenderPositiveReasonSet = new Set(Object.keys(tenderPositiveTerms).map(term => normTenderText(term)));
const tenderPositiveEntries = Object.entries(tenderPositiveTerms).map(([term, pts]) => [term, pts, normTenderText(term)]).sort((a, b) => b[2].length - a[2].length);
function hasTenderServiceSignal(item) {
  const reasons = item?.reasons || [];
  const text = item?.raw ? tenderText(item.raw) : tenderText(item);
  return reasons.some(reason => tenderPositiveReasonSet.has(normTenderText(reason))) || tenderPositiveEntries.some(([, , term]) => text.includes(term));
}
function scoreTender(row) {
  const text = tenderText(row); let score = 0; const reasons = []; const risks = [];
  const matchedPositiveTerms = [];
  for (const [term, pts, normalizedTerm] of tenderPositiveEntries) {
    if (text.includes(normalizedTerm) && !matchedPositiveTerms.some(matched => matched.includes(normalizedTerm) || normalizedTerm.includes(matched))) {
      matchedPositiveTerms.push(normalizedTerm);
      score += pts;
      reasons.push(term);
    }
  }
  const matchedFocusTerms = new Set();
  for (const [term, pts] of Object.entries(tenderFocusTerms)) {
    const normalizedTerm = normTenderText(term);
    if (!matchedFocusTerms.has(normalizedTerm) && text.includes(normalizedTerm)) {
      matchedFocusTerms.add(normalizedTerm);
      score += pts;
      reasons.push(`zona foco: ${term}`);
    }
  }
  for (const term of tenderDisqualifyingTerms) if (text.includes(normTenderText(term))) risks.push(`no ofertable: ${term}`);
  const value = tenderMoney(row.precio_base || row.cuantia_proceso);
  if (value >= 500000000) { score += 25; reasons.push('valor alto'); }
  else if (value > 0 && value < 50000000) { score -= 15; risks.push('valor bajo'); }
  if (!value) risks.push('valor no reportado / $0; validar');
  return { score, reasons: [...new Set(reasons)].slice(0, 7), risks: [...new Set(risks)].slice(0, 5) };
}
function classifyTenderSection(tender) {
  if (tender.risks.some(r => r.includes('no ofertable'))) return 'descartar';
  if (tender.score < 70 || (tender.value > 0 && tender.value < 50000000)) return 'descartar';
  if ((tender.days !== null && tender.days <= 10) || tender.score >= 180 || tender.value >= 1000000000) return 'hacer';
  return 'revisar';
}
function normalizeTender(row, source, scored) {
  const isSecop2 = source === 'SECOP II';
  const deadline = isSecop2 ? row.fecha_de_recepcion_de : null;
  const days = tenderDaysUntil(deadline);
  const value = tenderMoney(isSecop2 ? row.precio_base : row.cuantia_proceso);
  const url = isSecop2 ? (typeof row.urlproceso === 'object' ? row.urlproceso?.url : row.urlproceso) : row.ruta_proceso_en_secop_i;
  const tender = {
    source,
    entity: isSecop2 ? row.entidad || 'Sin entidad' : row.nombre_entidad || 'Sin entidad',
    dept: row.departamento_entidad || '', city: isSecop2 ? row.ciudad_entidad || '' : row.municipio_entidad || '',
    ref: isSecop2 ? row.referencia_del_proceso || '' : row.numero_de_proceso || '', process_id: isSecop2 ? row.id_del_proceso || '' : '',
    title: isSecop2 ? row.nombre_del_procedimiento || row.descripci_n_del_procedimiento || 'Sin objeto' : row.objeto_a_contratar || row.detalle_del_objeto_a_contratar || 'Sin objeto',
    desc: isSecop2 ? row.descripci_n_del_procedimiento || '' : row.detalle_del_objeto_a_contratar || '',
    value, status: isSecop2 ? row.fase || row.estado_del_procedimiento || '' : row.estado_del_proceso || '', category: isSecop2 ? row.codigo_principal_de_categoria || '' : '',
    published: (isSecop2 ? row.fecha_de_publicacion_del : row.fecha_de_cargue_en_el_secop) || null, deadline: deadline || null, days, window: tenderWindow(days),
    score: scored.score, reasons: scored.reasons, risks: scored.risks, url: url || '', raw: row
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}
function esuEntityField(source) { return source === 'SECOP II' ? 'entidad' : 'nombre_entidad'; }
function isEsuEntityRow(row, source) {
  const entity = normTenderText(row?.[esuEntityField(source)] || row?.entity || '');
  return entity.includes('empresa para la seguridad urbana')
    || entity.includes('empresa para la seguridad y soluciones urbanas')
    || /\bseguridad\b.*\burbana\b.*\besu\b/.test(entity);
}
function normalizeEsuDatosGovProcess(row, originalSource) {
  const scored = scoreTender(row);
  scored.score += 20;
  scored.reasons = [...new Set([`ESU vía datos.gov.co / ${originalSource}`, ...(scored.reasons || [])])];
  scored.risks = [...new Set([...(scored.risks || []), 'ESU vía datos.gov.co: validar fecha de cierre en SECOP/portal ESU', 'ESU vía datos.gov.co: validar documentos asociados y presupuesto antes de recomendar'])];
  const tender = normalizeTender(row, originalSource, scored);
  const withSource = {
    ...tender,
    source: 'ESU Contratación',
    source_origin: `datos.gov.co / ${originalSource}`,
    crm_next_step: 'Validar fecha de cierre y documentos en SECOP/portal ESU; si encaja, marcar en revisión o convertir desde CRM.',
    raw: { ...(tender.raw || row), source_origin: originalSource, discovery: 'datos.gov.co' }
  };
  return { ...withSource, id: stableTenderKey(withSource), stable_key: stableTenderKey(withSource), section: classifyTenderSection(withSource) };
}
function keywordWhere(fields) {
  const terms = ['vigilancia','seguridad privada','cctv','videovigilancia','control de acceso','alarma','monitoreo','camaras','cámaras','biometrico','biométrico'];
  const clauses = [];
  for (const field of fields) for (const term of terms) clauses.push(`lower(${field}) like '%${term.toLowerCase()}%'`);
  return clauses.join(' OR ');
}
async function fetchSecopSource(source, cfg) {
  const start = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) + 'T00:00:00';
  const params = new URLSearchParams({ '$select': cfg.select, '$where': `${cfg.dateField} >= '${start}' AND (${keywordWhere(cfg.nameFields)})`, '$order': `${cfg.dateField} DESC`, '$limit': '120' });
  const response = await fetch(`${cfg.base}?${params.toString()}`, { headers: { 'User-Agent': 'SN-CRM-Tenders-Radar/2.0' } });
  if (!response.ok) throw new Error(`${source} respondió ${response.status}`);
  const rows = await response.json();
  return rows.filter(row => !isEsuEntityRow(row, source) && isTenderTrackable(row)).map(row => ({ row, scored: scoreTender(row) })).filter(x => x.scored.score >= 35 && hasTenderServiceSignal(x.scored)).map(x => normalizeTender(x.row, source, x.scored));
}
function stripTenderHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function parseTenderTableRows(html) {
  const rows = [];
  const trMatches = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells = [];
    const re = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let match;
    while ((match = re.exec(tr))) cells.push(stripTenderHtml(match[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}
function normalizeTvecEvent(cells, aggregation, baseScore, url) {
  const [ref, title, entity, start, end, status, instrument, _supplier, order, rawValue] = cells;
  const deadline = end || null;
  const days = tenderDaysUntil(deadline);
  const rowText = normTenderText(`${entity} ${title} ${instrument} ${status} ${ref}`);
  let score = baseScore;
  const reasons = [`TVEC: ${instrument || aggregation}`];
  const risks = ['evento TVEC/RFQ: validar requisitos en Coupa/TVEC; valor puede aparecer $0 hasta adjudicación'];
  for (const [term, pts] of Object.entries(tenderFocusTerms)) if (rowText.includes(normTenderText(term))) { score += pts; reasons.push(`zona foco: ${term}`); }
  for (const [term, pts, normalizedTerm] of tenderPositiveEntries) if (rowText.includes(normalizedTerm)) { score += Math.min(pts, 25); reasons.push(term); }
  const tender = {
    source: 'TVEC',
    entity: entity || 'Sin entidad',
    dept: '', city: '', ref: ref || '', process_id: ref || '',
    title: title || aggregation,
    desc: `Instrumento: ${instrument || aggregation}; orden de compra asociada: ${order || '0'}`,
    value: tenderMoney(rawValue),
    status: status || '', category: instrument || aggregation,
    published: start || null, deadline, days, window: tenderWindow(days),
    score, reasons: [...new Set(reasons)].slice(0, 7), risks: [...new Set(risks)].slice(0, 5), url, raw: { ref, title, entity, start, end, status, instrument, order, rawValue, aggregation }
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}
async function fetchTvecEvents() {
  const candidates = [];
  const seen = new Set();
  for (const [aggregation, baseScore] of Object.entries(TVEC_RELEVANT_AGGREGATIONS)) {
    const url = `${TVEC_EVENTS_URL}?${new URLSearchParams({ Agregacion: aggregation }).toString()}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'SN-CRM-TVEC-Radar/1.0' } });
    if (!response.ok) throw new Error(`TVEC respondió ${response.status}`);
    const rows = parseTenderTableRows(await response.text());
    for (const cells of rows.slice(1)) {
      if (cells.length < 10) continue;
      const [ref, title, entity, _start, _end, status] = cells;
      const active = normTenderText(status).includes('produccion') || normTenderText(status).includes('producción');
      if (!active) continue;
      const key = `${ref}:${title}:${entity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tender = normalizeTvecEvent(cells, aggregation, baseScore, url);
      if (tender.days !== null && tender.days < 0) continue;
      candidates.push(tender);
    }
  }
  return candidates.sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
function parseEsuProcessRows(html) {
  const processes = [];
  const trMatches = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells = [];
    const re = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let match;
    while ((match = re.exec(tr))) cells.push(stripTenderHtml(match[1]));
    if (cells.length < 8 || /^n[ºo°]?$/i.test(cells[0]) || normTenderText(cells[1]) === 'numero') continue;
    const hrefMatch = tr.match(/href=["']([^"']*\/procesos\/view\/\d+)["']/i);
    const href = hrefMatch ? new URL(hrefMatch[1], ESU_CONTRATACION_ORIGIN).toString() : ESU_CONTRATACION_URL;
    processes.push({ cells, url: href });
  }
  return processes;
}
function parseEsuProcessId(url) {
  const match = String(url || '').match(/\/procesos\/view\/(\d+)/i);
  return match ? match[1] : '';
}
function htmlDecodeBasic(value) {
  return String(value || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ');
}
function parseEsuProcessDetail(html, url) {
  const clean = String(html || '');
  const plain = stripTenderHtml(clean.replace(/<br\s*\/?\s*>/gi, '\n'));
  const documents = [];
  for (const match of clean.matchAll(/href=["']([^"']*\/procesos\/descargar\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1], ESU_CONTRATACION_ORIGIN).toString();
    const fileName = decodeURIComponent(href.split('/').pop() || '').replace(/\+/g, ' ');
    documents.push({ name: fileName || stripTenderHtml(match[2]) || 'Documento ESU', url: href, type: normalizeDocumentType('', fileName || match[2]) });
  }
  const email = (clean.match(/[A-Z0-9._%+-]+@esu\.com\.co/i) || [null])[0];
  const ciiu = Array.from(clean.matchAll(/>(\d{6}\s*-\s*[^<]+)</g)).slice(0, 12).map(m => stripTenderHtml(m[1]));
  const lines = [];
  for (const label of Object.values(ESU_RELEVANT_CATEGORY_IDS)) if (normTenderText(plain).includes(normTenderText(label))) lines.push(label);
  return { url, email, ciiu, lines: [...new Set(lines)], documents, text: htmlDecodeBasic(plain).slice(0, 4000) };
}
function normalizeEsuProcess(process, detail = null) {
  const cells = process.cells || [];
  const [_rowNumber, numero, objeto, tipoProceso, fechaApertura, fechaCierre, estado, funcionario] = cells;
  const detailText = detail?.text || '';
  const row = {
    nombre_entidad: 'Empresa para la Seguridad y Soluciones Urbanas - ESU',
    departamento_entidad: 'Antioquia',
    municipio_entidad: 'Medellín',
    numero_de_proceso: numero || '',
    objeto_a_contratar: objeto || '',
    detalle_del_objeto_a_contratar: `${tipoProceso || ''} ${estado || ''} ${funcionario || ''} ${(detail?.lines || []).join(' ')} ${(detail?.ciiu || []).join(' ')}`.trim(),
    estado_del_proceso: estado || '',
    fecha_de_cargue_en_el_secop: fechaApertura || null,
    cuantia_proceso: 0,
    ruta_proceso_en_secop_i: process.url || ESU_CONTRATACION_URL
  };
  const scored = scoreTender(row);
  if (normTenderText(estado).includes('convocado')) { scored.score += 20; scored.reasons = [...new Set([...(scored.reasons || []), 'ESU convocado'])]; }
  if ((detail?.documents || []).length) scored.reasons = [...new Set([...(scored.reasons || []), 'documentos ESU disponibles'])];
  const deadline = fechaCierre || null;
  const days = tenderDaysUntil(deadline);
  const tender = {
    source: 'ESU Contratación',
    entity: row.nombre_entidad, dept: row.departamento_entidad, city: row.municipio_entidad,
    ref: numero || '', process_id: numero || '', title: objeto || 'Sin objeto', desc: [row.detalle_del_objeto_a_contratar, detail?.email ? `Responsable: ${funcionario || ''} (${detail.email})` : ''].filter(Boolean).join(' · '),
    value: 0, status: estado || '', category: (detail?.lines || []).join(', ') || tipoProceso || '',
    published: fechaApertura || null, deadline, days, window: tenderWindow(days),
    score: scored.score, reasons: [...new Set(scored.reasons || [])].slice(0, 7), risks: [...new Set([...(scored.risks || []), 'ESU: validar pliego/anexos en detalle del proceso'])].slice(0, 5),
    url: process.url || ESU_CONTRATACION_URL, raw: { numero, objeto, tipoProceso, fechaApertura, fechaCierre, estado, funcionario, ciiu: detail?.ciiu || [], lines: detail?.lines || [], documents: detail ? detail.documents || [] : [], documents_count: detail?.documents?.length || 0 }
  };
  const withId = { ...tender, section: classifyTenderSection(tender) };
  return { ...withId, id: stableTenderKey(withId), stable_key: stableTenderKey(withId), internal_status: 'nueva', converted_opportunity_id: null };
}
async function fetchEsuHtml(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'User-Agent': 'SN-CRM-ESU-Tenders-Radar/1.0', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`ESU Contratación directo respondió ${response.status}`);
  const html = await response.text();
  if (/Not Acceptable|Mod_Security|Incapsula|_Incapsula_Resource/i.test(html)) throw new Error('bloqueo anti-bot/mod_security de ESU Contratación directo');
  return html;
}
async function fetchEsuIndexPages(maxPages = 5) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? ESU_CONTRATACION_URL : `${ESU_CONTRATACION_URL}/page:${page}`;
    const pageRows = parseEsuProcessRows(await fetchEsuHtml(url));
    if (!pageRows.length) break;
    rows.push(...pageRows);
    if (pageRows.length < 20) break;
  }
  return rows;
}
function esuSearchBody({ estadoId = '0', categoryIds = [], keyword = '' } = {}) {
  const body = new URLSearchParams();
  body.set('_method', 'POST');
  body.set('data[Proceso][estado_id]', estadoId);
  if (keyword) body.set('data[Proceso][objeto]', keyword);
  for (const id of categoryIds) body.append('data[Categoria][Categoria][]', id);
  return body;
}
async function searchEsuProcesses(params) {
  const html = await fetchEsuHtml(`${ESU_CONTRATACION_ORIGIN}/procesos/buscar#resultados`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${ESU_CONTRATACION_ORIGIN}/procesos/buscar` }, body: esuSearchBody(params) });
  return parseEsuProcessRows(html);
}
async function fetchEsuProcessDetail(process) {
  if (!process?.url || !parseEsuProcessId(process.url)) return null;
  try {
    return parseEsuProcessDetail(await fetchEsuHtml(process.url), process.url);
  } catch {
    return null;
  }
}
async function fetchEsuProcesses() {
  const seen = new Map();
  const addRows = rows => {
    for (const row of rows || []) {
      const key = parseEsuProcessId(row.url) || `${row.cells?.[1]}:${row.cells?.[2]}`;
      if (!seen.has(key)) seen.set(key, row);
    }
  };
  const tryAddRows = async label => {
    try { addRows(await label.run()); }
    catch (error) { console.warn(`ESU recorrido omitido (${label.name}): ${error?.message || error}`); }
  };
  await tryAddRows({ name: 'índice paginado', run: () => fetchEsuIndexPages(5) });
  await tryAddRows({ name: 'convocados', run: () => searchEsuProcesses({ estadoId: '19' }) });
  await tryAddRows({ name: 'categorías relevantes', run: () => searchEsuProcesses({ estadoId: '19', categoryIds: Object.keys(ESU_RELEVANT_CATEGORY_IDS) }) });
  for (const keyword of ESU_RELEVANT_KEYWORDS) await tryAddRows({ name: `keyword ${keyword}`, run: () => searchEsuProcesses({ estadoId: '19', keyword }) });
  const preliminary = Array.from(seen.values()).map(row => normalizeEsuProcess(row)).filter(t => t.score >= 35).filter(t => t.days === null || t.days >= 0).filter(isTenderTrackable).sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999)).slice(0, 40);
  const enriched = [];
  for (const tender of preliminary) {
    const sourceRow = seen.get(parseEsuProcessId(tender.url));
    const detail = await fetchEsuProcessDetail(sourceRow);
    enriched.push(normalizeEsuProcess(sourceRow, detail));
  }
  return enriched.filter(t => t.score >= 35).filter(t => t.days === null || t.days >= 0).filter(isTenderTrackable).sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
async function fetchEsuDatosGovProcesses() {
  const start = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) + 'T00:00:00';
  const candidates = [];
  const seen = new Set();
  for (const [source, cfg] of Object.entries(tenderSources)) {
    for (const term of ESU_DATOS_GOV_ENTITY_TERMS) {
      const params = new URLSearchParams({ '$select': cfg.select, '$q': term, '$where': `${cfg.dateField} >= '${start}'`, '$order': `${cfg.dateField} DESC`, '$limit': '500' });
      const response = await fetch(`${cfg.base}?${params.toString()}`, { headers: { 'User-Agent': 'SN-CRM-ESU-DatosGov-Radar/1.0' } });
      if (!response.ok) throw new Error(`ESU vía datos.gov.co ${source} respondió ${response.status}`);
      const rows = await response.json();
      for (const row of rows) {
        if (!isEsuEntityRow(row, source)) continue;
        const tender = normalizeEsuDatosGovProcess(row, source);
        if (tender.score < 35 || (tender.days !== null && tender.days < 0) || !isTenderTrackable(tender)) continue;
        const key = `${tender.source_origin}:${tender.ref}:${tender.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(tender);
      }
    }
  }
  return candidates.sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
}
async function fetchPublicTenderRadar() {
  const tasks = [
    ...Object.entries(tenderSources).map(([source, cfg]) => ({ source, run: () => fetchSecopSource(source, cfg) })),
    { source: 'TVEC', run: fetchTvecEvents },
    { source: 'ESU Contratación directo', run: fetchEsuProcesses },
    { source: 'ESU vía datos.gov.co', run: fetchEsuDatosGovProcesses }
  ];
  const settled = await Promise.allSettled(tasks.map(t => t.run()));
  const diagnostics = [];
  const batches = [];
  settled.forEach((result, index) => {
    const source = tasks[index].source;
    if (result.status === 'fulfilled') {
      batches.push(result.value);
      diagnostics.push({ source, status: 'ok', count: result.value.length, message: result.value.length ? `${result.value.length} candidato(s)` : 'Sin candidatos relevantes hoy' });
    } else {
      const message = source === 'TVEC'
        ? `TVEC no disponible temporalmente: ${result.reason?.message || result.reason}`
        : source === 'ESU Contratación directo'
          ? `ESU Contratación no disponible temporalmente (directo): ${result.reason?.message || result.reason}`
          : `${source} no disponible temporalmente: ${result.reason?.message || result.reason}`;
      diagnostics.push({ source, status: 'error', count: 0, message });
    }
  });
  const seen = new Set();
  const tenders = batches.flat().filter(t => {
    if (t.days !== null && t.days < 0) return false;
    if (!isTenderTrackable(t)) return false;
    const key = t.stable_key || stableTenderKey(t);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b) => {
    const sectionOrder = { hacer: 0, revisar: 1, descartar: 2 };
    return sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || (a.days ?? 999) - (b.days ?? 999);
  }).slice(0, 80);
  return { tenders, diagnostics };
}
function radarPayload(tenders, generatedAt = new Date().toISOString(), source = 'live', diagnostics = []) {
  const normalized = tenders.map(t => ({ ...t, id: t.stable_key || t.id || stableTenderKey(t), stable_key: t.stable_key || t.id || stableTenderKey(t) }));
  return {
    generatedAt,
    source,
    diagnostics,
    totals: {
      all: normalized.length,
      hacer: normalized.filter(t => t.section === 'hacer').length,
      revisar: normalized.filter(t => t.section === 'revisar').length,
      descartar: normalized.filter(t => t.section === 'descartar').length,
      highValue: normalized.filter(t => Number(t.value || 0) >= 500000000).length,
      urgent: normalized.filter(t => t.days !== null && t.days !== undefined && t.days <= 7).length,
      enRevision: normalized.filter(t => t.internal_status === 'en_revision').length,
      convertidas: normalized.filter(t => t.internal_status === 'convertida_oportunidad' || t.converted_opportunity_id).length,
      descartadas: normalized.filter(t => t.internal_status === 'descartada').length
    },
    tenders: normalized
  };
}
function isMissingTenderTable(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return msg.includes('42p01') || msg.includes('psi_public_tenders') || msg.includes('psi_tender_radar_runs');
}
async function tenderTableAvailable(database) {
  const { error } = await database.from('psi_public_tenders').select('id').limit(1);
  if (!error) return true;
  if (isMissingTenderTable(error)) return false;
  throw error;
}
function dbTenderToPublic(row) {
  return {
    id: row.stable_key,
    stable_key: row.stable_key,
    source: row.source,
    section: row.section,
    entity: row.entity,
    dept: row.dept || '', city: row.city || '', ref: row.ref || '', process_id: row.process_id || '',
    title: row.title, desc: row.description || '', value: Number(row.value || 0), status: row.status || '', category: row.category || '',
    published: row.published_at, deadline: row.deadline_at, days: tenderDaysUntil(row.deadline_at), window: tenderWindow(tenderDaysUntil(row.deadline_at)),
    score: Number(row.score || 0), reasons: row.reasons || [], risks: row.risks || [], url: row.url || '',
    internal_status: row.internal_status || 'nueva', converted_opportunity_id: row.converted_opportunity_id || null,
    reviewed_by: row.reviewed_by || null, reviewed_at: row.reviewed_at || null, detected_at: row.detected_at || row.created_at || null, last_seen_at: row.last_seen_at || null
  };
}
function isConvertedTenderRecord(row) {
  return row?.internal_status === 'convertida_oportunidad' || Boolean(row?.converted_opportunity_id);
}
async function readAllConvertedTenderRows(database) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const result = await database.from('psi_public_tenders').select('*')
      .or('internal_status.eq.convertida_oportunidad,converted_opportunity_id.not.is.null')
      .order('last_seen_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
async function readPersistedTenderRadar(database) {
  const latestRunResult = await database.from('psi_tender_radar_runs').select('run_at,mode').order('run_at', { ascending: false }).limit(1).maybeSingle();
  if (latestRunResult.error && !isMissingTenderTable(latestRunResult.error)) throw latestRunResult.error;
  const latestRunAt = latestRunResult.data?.run_at || null;
  const cutoff = latestRunAt;
  const activeDeadlineCutoff = new Date();
  activeDeadlineCutoff.setUTCHours(0, 0, 0, 0);
  let query = database.from('psi_public_tenders').select('*').order('last_seen_at', { ascending: false }).limit(250);
  if (cutoff) query = query.or(`last_seen_at.gte.${cutoff},deadline_at.gte.${activeDeadlineCutoff.toISOString()}`);
  let { data, error } = await query;
  if (error) {
    if (isMissingTenderTable(error)) return null;
    throw error;
  }
  if ((!data || !data.length) && cutoff) {
    const fallback = await database.from('psi_public_tenders').select('*').order('last_seen_at', { ascending: false }).limit(250);
    if (fallback.error) throw fallback.error;
    data = fallback.data || [];
  }
  let convertedRows;
  try {
    convertedRows = await readAllConvertedTenderRows(database);
  } catch (convertedError) {
    if (isMissingTenderTable(convertedError)) return null;
    throw convertedError;
  }
  const mergedRows = Array.from(new Map([...(data || []), ...convertedRows].map((row, index) => [row.stable_key || row.id || `radar-row-${index}`, row])).values());
  const rows = mergedRows.filter(row => isConvertedTenderRecord(row) || isTenderTrackable(row)).map(dbTenderToPublic).filter(t => isConvertedTenderRecord(t) || !['SECOP I','SECOP II'].includes(t.source) || hasTenderServiceSignal(t)).sort((a,b) => {
    const statusOrder = { nueva: 0, en_revision: 1, convertida_oportunidad: 2, descartada: 3 };
    const sectionOrder = { hacer: 0, revisar: 1, descartar: 2 };
    return (statusOrder[a.internal_status] ?? 9) - (statusOrder[b.internal_status] ?? 9) || sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score;
  });
  return radarPayload(rows, latestRunAt || rows[0]?.last_seen_at || new Date().toISOString(), 'supabase', [{ source: 'Supabase', status: 'ok', count: rows.length, message: latestRunAt ? `Radar historizado desde última corrida (${latestRunResult.data?.mode || 'run'})` : 'Radar historizado' }]);
}
async function enrichLiveTendersWithConversions(database, tenders) {
  const keys = tenders.map(t => `secop_radar:${t.source}:${stableTenderKey(t)}`);
  if (!keys.length) return tenders;
  const { data } = await database.from('psi_sales_opportunities').select('id,external_source').in('external_source', keys);
  const bySource = new Map((data || []).map(o => [o.external_source, o.id]));
  return tenders.map(t => {
    const opportunityId = bySource.get(`secop_radar:${t.source}:${stableTenderKey(t)}`) || null;
    return { ...t, converted_opportunity_id: opportunityId, internal_status: opportunityId ? 'convertida_oportunidad' : (t.internal_status || 'nueva') };
  });
}
async function persistTenderRadar(database, actorProfile, mode = 'manual') {
  const fetchedPayload = await fetchPublicTenderRadar();
  const fetched = fetchedPayload.tenders;
  const diagnostics = fetchedPayload.diagnostics;
  if (!(await tenderTableAvailable(database))) {
    const live = await enrichLiveTendersWithConversions(database, fetched);
    return radarPayload(live, new Date().toISOString(), 'live_no_table', diagnostics);
  }
  const now = new Date().toISOString();
  const rows = fetched.map(t => ({
    stable_key: stableTenderKey(t), source: t.source, section: t.section, entity: t.entity, dept: t.dept || null, city: t.city || null,
    ref: t.ref || null, process_id: t.process_id || null, title: t.title, description: t.desc || null, value: Number(t.value || 0),
    status: t.status || null, category: t.category || null, published_at: t.published || null, deadline_at: t.deadline || null,
    score: Number(t.score || 0), reasons: t.reasons || [], risks: t.risks || [], url: t.url || null, raw: t.raw || null, last_seen_at: now
  }));
  if (rows.length) {
    const { error: upsertError } = await database.from('psi_public_tenders').upsert(rows, { onConflict: 'stable_key', defaultToNull: false });
    if (upsertError) throw upsertError;
  }
  await database.from('psi_tender_radar_runs').insert({ run_at: now, triggered_by: actorProfile?.id || null, mode, count_total: rows.length, count_hacer: rows.filter(r => r.section === 'hacer').length, count_revisar: rows.filter(r => r.section === 'revisar').length, count_descartar: rows.filter(r => r.section === 'descartar').length, summary: `Radar multifuente sincronizado: ${rows.length} procesos/eventos. ${diagnostics.map(d => `${d.source}: ${d.status}`).join(' · ')}` });
  const persisted = await readPersistedTenderRadar(database);
  return { ...persisted, diagnostics };
}
async function buildTenderRadar(database, currentProfile, forceRefresh = false) {
  if (forceRefresh) return await persistTenderRadar(database, currentProfile, 'manual');
  if (await tenderTableAvailable(database)) {
    const persisted = await readPersistedTenderRadar(database);
    if (persisted?.tenders?.length) return persisted;
    return await persistTenderRadar(database, currentProfile, 'auto_empty');
  }
  const fetchedPayload = await fetchPublicTenderRadar();
  const live = await enrichLiveTendersWithConversions(database, fetchedPayload.tenders);
  return radarPayload(live, new Date().toISOString(), 'live_no_table', fetchedPayload.diagnostics);
}
async function findTenderOwner(database, currentProfile) {
  const { data } = await database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active').ilike('microsoft_email', 'directora.licitaciones@seguridadnacional.co').eq('active', true).maybeSingle();
  return data || currentProfile;
}
function buildTenderOpportunityPayload(tender, owner) {
  const notes = [
    `Origen: ${tender.source} / Radar Licitaciones`,
    `Referencia: ${tender.ref || tender.process_id || '—'}`,
    `Objeto: ${tender.title}`,
    `Entidad: ${tender.entity}`,
    `Ubicación: ${tender.city || tender.dept || '—'}`,
    `Score radar: ${tender.score}`,
    `Razones: ${(tender.reasons || []).join(', ') || '—'}`,
    tender.url ? `Link fuente: ${tender.url}` : '',
  ].filter(Boolean).join('\n');
  return {
    company_name: tender.entity,
    owner_id: owner.id,
    stage_code: 'prospecto',
    service_type_code: 'licitacion_publica',
    offer_value: Number(tender.value || 0),
    expected_close_date: tender.deadline || null,
    quote_city: tender.city || tender.dept || null,
    regional_nombre: tender.dept || null,
    sede: tender.ref || tender.process_id || null,
    economic_sector: 'Sector público',
    tipo_producto_original: 'Licitación Pública',
    observaciones: notes,
    external_source: `secop_radar:${tender.source}:${stableTenderKey(tender)}`
  };
}
async function getPersistedTenderByStableKey(database, stableKey) {
  const { data, error } = await database.from('psi_public_tenders')
    .select('id,stable_key,internal_status,converted_opportunity_id,tracking_updated_at')
    .eq('stable_key', stableKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw trackingError('La licitación persistida no existe; no se puede omitir la trazabilidad de seguimiento.', 409);
  return data;
}
async function setTenderStatus(database, stableKey, internalStatus, currentProfile) {
  if (!tenderInternalStatuses.includes(internalStatus)) throw new Error('Estado interno de licitación inválido.');
  if (!(await tenderTableAvailable(database))) throw new Error('La tabla psi_public_tenders aún no existe. Aplica la migración para guardar estados internos.');
  if (internalStatus === 'convertida_oportunidad') throw trackingError('La conversión debe usar el flujo de convertir a oportunidad.', 400);
  const tender = await getPersistedTenderByStableKey(database, stableKey);
  if (tender.internal_status === 'convertida_oportunidad' && (internalStatus === 'descartada' || internalStatus === 'nueva')) {
    throw trackingError('Una licitación convertida debe descartarse con Sacar de oportunidad.', 409);
  }
  const updated = internalStatus === 'en_revision'
    ? await callTenderTrackingUpdate(database, tender.id, {
      tracking_owner_id: currentProfile.id,
      tracking_status: 'pendiente_revision',
      expected_tracking_updated_at: tender.internal_status === 'nueva' ? null : tender.tracking_updated_at,
    }, currentProfile)
    : await callTenderTrackingTransition(database, tender.id, {
      internal_status: internalStatus,
      expected_tracking_updated_at: tender.tracking_updated_at,
    }, currentProfile);
  return dbTenderToPublic(updated);
}

const tenderTrackingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trackingError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireTenderTrackingId(value) {
  const tenderId = String(value || '').trim();
  if (!tenderTrackingIdPattern.test(tenderId)) throw trackingError('Debe indicar una licitación válida.');
  return tenderId;
}

async function getTenderTrackingTender(database, tenderId) {
  const { data, error } = await database.from('psi_public_tenders').select('*').eq('id', tenderId).maybeSingle();
  if (error) throw error;
  if (!data) throw trackingError('La licitación no existe.', 404);
  return data;
}

function requireTenderTrackingAccess(profile) {
  if (!canViewTenders(profile)) throw trackingError('Solo dirección o licitaciones puede gestionar seguimiento.', 403);
}

app.get('/api/tender-tracking', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const tenders = await must(requireDb().from('psi_public_tenders').select('*').eq('internal_status', 'en_revision').order('tracking_due_at', { ascending: true, nullsFirst: false }).order('tracking_updated_at', { ascending: false }));
    res.json(tenders || []);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-tracking-events', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const database = requireDb();
    const tenderId = requireTenderTrackingId(req.query.id);
    await getTenderTrackingTender(database, tenderId);
    res.json(await must(database.from('psi_tender_tracking_events').select('*').eq('tender_id', tenderId).order('created_at', { ascending: false })) || []);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-tracking-update', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const tenderId = requireTenderTrackingId(req.body?.id);
    res.json(await callTenderTrackingUpdate(requireDb(), tenderId, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-tracking-transition', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const tenderId = requireTenderTrackingId(req.body?.id);
    res.json(await callTenderTrackingTransition(requireDb(), tenderId, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tenders', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await buildTenderRadar(database, currentProfile, req.query.refresh === '1'));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/tender-search-profiles', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver perfiles de búsqueda.'); error.status = 403; throw error; }
    res.json(await listTenderSearchProfiles(requireDb()));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-search-profiles', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede guardar perfiles de búsqueda.'); error.status = 403; throw error; }
    res.status(201).json(await saveTenderSearchProfile(requireDb(), req.body, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.delete('/api/tender-search-profiles/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede eliminar perfiles de búsqueda.'); error.status = 403; throw error; }
    res.json(await deleteTenderSearchProfile(requireDb(), req.params.id));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-company-profile', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver esta ficha.'); error.status = 403; throw error; }
    res.json(await getTenderCompanyProfile(requireDb()));
  } catch (error) { sendAuthError(res, error); }
});

app.put('/api/tender-company-profile', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede editar esta ficha.'); error.status = 403; throw error; }
    const database = requireDb();
    await saveTenderCompanyProfile(database, cleanTenderCompanyProfile(req.body, currentProfile));
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-upload-url', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede cargar el RUP.'); error.status = 403; throw error; }
    const database = requireDb();
    const name = cleanFileName(req.body?.name || 'rup-actualizado.pdf');
    const size = Number(req.body?.size || 0);
    if (!size) throw new Error('Debe seleccionar un archivo RUP válido.');
    if (size > RUP_MAX_BYTES) throw new Error('El RUP supera 50MB. Reduzca el archivo o cargue una versión PDF/DOCX más liviana.');
    await ensureTenderBucket(database);
    const id = createHash('sha256').update(`company-profile:${Date.now()}:${name}:${size}`).digest('hex').slice(0, 24);
    const storagePath = `company-profile/rup/${id}-${name}`;
    const { data, error } = await database.storage.from(tenderDocumentBucket).createSignedUploadUrl(storagePath);
    if (error) throw error;
    res.json({ path: storagePath, token: data.token });
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-process-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede procesar el RUP.'); error.status = 403; throw error; }
    const database = requireDb();
    const storagePath = String(req.body?.storage_path || '');
    if (!storagePath.startsWith('company-profile/rup/')) throw new Error('Ruta de RUP inválida.');
    const name = cleanFileName(req.body?.name || storagePath.split('/').at(-1) || 'rup-actualizado.pdf');
    const { data, error } = await database.storage.from(tenderDocumentBucket).download(storagePath);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.length) throw new Error('El RUP cargado está vacío.');
    const extractedText = await extractTextFromTenderFile(buffer, name, req.body?.mime_type || '');
    const existing = await getTenderCompanyProfile(database);
    const payload = cleanTenderCompanyProfile(parseRupCompanyProfile(extractedText, existing, name), currentProfile);
    await saveTenderCompanyProfile(database, payload);
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede cargar el RUP.'); error.status = 403; throw error; }
    const database = requireDb();
    const name = cleanFileName(req.body?.name || 'rup-actualizado.pdf');
    const buffer = Buffer.from(String(req.body?.content_base64 || ''), 'base64');
    if (!buffer.length) throw new Error('Debe cargar un archivo RUP válido.');
    if (buffer.length > RUP_MAX_BYTES) throw new Error('El RUP supera 50MB.');
    const extractedText = await extractTextFromTenderFile(buffer, name, req.body?.mime_type || '');
    const existing = await getTenderCompanyProfile(database);
    const payload = cleanTenderCompanyProfile(parseRupCompanyProfile(extractedText, existing, name), currentProfile);
    await saveTenderCompanyProfile(database, payload);
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tenders/refresh', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await persistTenderRadar(database, currentProfile, 'manual'));
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/tenders/:id/status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await setTenderStatus(database, decodeURIComponent(req.params.id), req.body.internal_status, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tenders/convert', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    const tender = req.body?.tender || req.body;
    const result = await convertTenderToOpportunity(database, tender, currentProfile);
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { sendError(res, error, error?.status || 400); }
});


app.post('/api/tender-refresh', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    res.json(await persistTenderRadar(database, currentProfile, 'manual'));
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/tender-status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    const stableKey = String(req.query.id || '');
    if (!stableKey) throw new Error('Debe indicar la licitación.');
    res.json(await setTenderStatus(database, stableKey, req.body.internal_status, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-convert', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    if (!canViewTenders(currentProfile)) { const error = new Error('Solo dirección o licitaciones puede ver este radar.'); error.status = 403; throw error; }
    const database = requireDb();
    const tender = req.body?.tender || req.body;
    const result = await convertTenderToOpportunity(database, tender, currentProfile);
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

const siioTables = {
  fronts: 'siio_fronts',
  sources: 'siio_sources',
  records: 'siio_gerencial_records',
  decisions: 'siio_decisions_commitments',
  boardReports: 'siio_monthly_board_reports',
  boardSections: 'siio_board_sections',
  financialMetrics: 'siio_financial_metrics',
  commercialSignals: 'siio_commercial_signals',
  payrollAggregates: 'siio_payroll_aggregates',
  strategicOpportunities: 'siio_strategic_opportunities'
};
async function optionalSiioList(database, table, select = '*', order = 'created_at') {
  const query = database.from(table).select(select).limit(1000);
  if (order) query.order(order, { ascending: table === 'siio_board_sections' });
  const { data, error } = await query;
  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('does not exist') || message.includes('schema cache')) return [];
    throw error;
  }
  return data || [];
}
function cleanSiioRecord(body = {}, profile) {
  const allowedPriority = ['crítica','alta','media','baja'];
  const allowedSemaforo = ['verde','amarillo','rojo'];
  const priority = allowedPriority.includes(body.priority) ? body.priority : 'media';
  const semaforo = allowedSemaforo.includes(body.semaforo) ? body.semaforo : 'amarillo';
  return {
    id: String(body.id || '').trim(),
    front_id: String(body.front_id || 'F2').trim(),
    title: String(body.title || '').trim(),
    record_type: String(body.record_type || 'iniciativa').trim(),
    objective: String(body.objective || '').trim(),
    area: body.area || null,
    owner: body.owner || null,
    sponsor: body.sponsor || null,
    status: String(body.status || 'diseño').trim(),
    priority,
    semaforo,
    next_milestone: body.next_milestone || null,
    next_action: body.next_action || null,
    commitment_date: body.commitment_date || null,
    blockers: body.blockers || null,
    risks: body.risks || null,
    decision_required: body.decision_required || null,
    decision_owner: body.decision_owner || null,
    source_ids: Array.isArray(body.source_ids) ? body.source_ids : [],
    executive_notes: body.executive_notes || null,
    updated_by: profile.id
  };
}
function cleanSiioSource(body = {}) {
  return {
    id: String(body.id || '').trim(),
    name: String(body.name || '').trim(),
    source_type: String(body.source_type || 'documento').trim(),
    related_fronts: Array.isArray(body.related_fronts) ? body.related_fronts : [],
    related_records: Array.isArray(body.related_records) ? body.related_records : [],
    url: body.url || null,
    owner: body.owner || null,
    responsible_area: body.responsible_area || null,
    trust_level: body.trust_level || 'pendiente',
    status: body.status || 'activa',
    permissions: body.permissions || '',
    allowed_agent_use: body.allowed_agent_use || '',
    restrictions: body.restrictions || '',
    update_frequency: body.update_frequency || 'bajo demanda'
  };
}
function cleanSiioDecision(body = {}, profile) {
  const allowedTypes = ['decision','compromiso','bloqueo','riesgo'];
  const allowedStatus = ['pendiente','en_proceso','bloqueado','cerrado','vencido'];
  const item_type = allowedTypes.includes(body.item_type) ? body.item_type : 'decision';
  const status = allowedStatus.includes(body.status) ? body.status : 'pendiente';
  return {
    item_type,
    origin: body.origin || 'gerencia',
    related_record_id: body.related_record_id || null,
    description: String(body.description || '').trim(),
    owner: body.owner || null,
    due_date: body.due_date || null,
    status,
    impact: body.impact || null,
    source_ids: Array.isArray(body.source_ids) ? body.source_ids : [],
    updated_by: profile.id
  };
}

function filterBoardReportsForProfile(profile, rows) {
  if (profile?.role !== 'junta') return rows;
  return rows.filter(row => can(profile, ACTIONS.BOARD_PUBLICATION_VIEW, {
    publication_status: row?.publication_status ?? row?.status,
  }));
}

app.get('/api/siio/bootstrap', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    requireSiioEndpointAccess(profile, 'GET /api/siio/bootstrap');
    const database = requireDb();
    if (profile.role === 'junta') {
      const boardReports = filterBoardReportsForProfile(profile, await optionalSiioList(database, siioTables.boardReports, '*', 'period_month'));
      return res.json({ fronts: [], records: [], sources: [], decisions: [], boardReports, boardSections: [], financialMetrics: [], commercialSignals: [], payrollAggregates: [], strategicOpportunities: [], currentProfile: profile });
    }
    const [fronts, records, sources, decisions, boardReports, boardSections, financialMetrics, commercialSignals, payrollAggregates, strategicOpportunities] = await Promise.all([
      optionalSiioList(database, siioTables.fronts, '*', 'id'),
      optionalSiioList(database, siioTables.records, '*', 'updated_at'),
      optionalSiioList(database, siioTables.sources, '*', 'id'),
      optionalSiioList(database, siioTables.decisions, '*', 'created_at'),
      optionalSiioList(database, siioTables.boardReports, '*', 'period_month'),
      optionalSiioList(database, siioTables.boardSections, '*', 'section_order'),
      optionalSiioList(database, siioTables.financialMetrics, '*', 'period_month'),
      optionalSiioList(database, siioTables.commercialSignals, '*', 'period_month'),
      optionalSiioList(database, siioTables.payrollAggregates, 'id,period_month,area,total_people,total_accrued,total_deductions,net_total,variation_abs,alert,source_id,visibility_level', 'period_month'),
      optionalSiioList(database, siioTables.strategicOpportunities, '*', 'id')
    ]);
    res.json({ fronts, records, sources, decisions, boardReports, boardSections, financialMetrics, commercialSignals, payrollAggregates, strategicOpportunities, currentProfile: profile });
  } catch (error) { sendAuthError(res, error); }
});
app.get('/api/siio/fronts', async (req, res) => {
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/fronts'); res.json(await optionalSiioList(requireDb(), siioTables.fronts, '*', 'id')); }
  catch (error) { sendAuthError(res, error); }
});
app.get('/api/siio/records', async (req, res) => {
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/records'); res.json(await optionalSiioList(requireDb(), siioTables.records, '*', 'updated_at')); }
  catch (error) { sendAuthError(res, error); }
});
app.post('/api/siio/records', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'POST /api/siio/records');
    const payload = { ...cleanSiioRecord(req.body, profile), created_by: profile.id };
    if (!payload.id || !payload.title) throw new Error('ID y título son obligatorios.');
    res.json(await must(requireDb().from(siioTables.records).insert(payload).select('*').single()));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.patch('/api/siio/records/:id', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'PATCH /api/siio/records/:id');
    const payload = cleanSiioRecord({ ...req.body, id: req.params.id }, profile); delete payload.id; delete payload.created_by;
    res.json(await must(requireDb().from(siioTables.records).update(payload).eq('id', req.params.id).select('*').single()));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.get('/api/siio/sources', async (req, res) => {
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/sources'); res.json(await optionalSiioList(requireDb(), siioTables.sources, '*', 'id')); }
  catch (error) { sendAuthError(res, error); }
});
app.post('/api/siio/sources', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'POST /api/siio/sources');
    const payload = cleanSiioSource(req.body);
    if (!payload.id || !payload.name) throw new Error('ID y nombre de fuente son obligatorios.');
    res.json(await must(requireDb().from(siioTables.sources).upsert(payload).select('*').single()));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.get('/api/siio/decisions', async (req, res) => {
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/decisions'); res.json(await optionalSiioList(requireDb(), siioTables.decisions, '*', 'created_at')); }
  catch (error) { sendAuthError(res, error); }
});
app.post('/api/siio/decisions', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'POST /api/siio/decisions');
    const payload = { ...cleanSiioDecision(req.body, profile), created_by: profile.id };
    if (!payload.description) throw new Error('La descripción es obligatoria.');
    res.json(await must(requireDb().from(siioTables.decisions).insert(payload).select('*').single()));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.patch('/api/siio/decisions/:id', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'PATCH /api/siio/decisions/:id');
    res.json(await must(requireDb().from(siioTables.decisions).update(cleanSiioDecision(req.body, profile)).eq('id', req.params.id).select('*').single()));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.get('/api/siio/board-reports', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    requireSiioEndpointAccess(profile, 'GET /api/siio/board-reports');
    res.json(filterBoardReportsForProfile(profile, await optionalSiioList(requireDb(), siioTables.boardReports, '*', 'period_month')));
  } catch (error) { sendAuthError(res, error); }
});

const VIGIA_PAGE_SIZE = 1000;
const VIGIA_OWNER_BATCH_SIZE = 100;
function throwVigiaScopeForbidden() {
  const error = new Error('No tiene un alcance comercial vigente para consultar Vig-IA.');
  error.status = 403;
  error.code = 'FORBIDDEN';
  throw error;
}
async function resolveVigiaOwnerScope(database, profile) {
  if (globalCrmScopeRoles.has(profile?.role)) return null;
  if (!profile?.areas?.some(area => area.area_code === 'comercial')) throwVigiaScopeForbidden();
  const rows = await must(database.from('psi_profile_area_assignments').select('profile_id,area_code,subarea_code').eq('area_code', 'comercial'));
  const ownerAssignments = assignmentsByProfile(rows);
  const ownerIds = Array.from(ownerAssignments.keys()).filter(ownerId => canReadCrmRow(profile, { owner_id: ownerId }, ownerAssignments));
  if (!ownerIds.length) throwVigiaScopeForbidden();
  return ownerIds.sort();
}
async function fetchVigiaRows(database, ownerIds) {
  const batches = ownerIds === null
    ? [null]
    : Array.from({ length: Math.ceil(ownerIds.length / VIGIA_OWNER_BATCH_SIZE) }, (_, index) => ownerIds.slice(index * VIGIA_OWNER_BATCH_SIZE, (index + 1) * VIGIA_OWNER_BATCH_SIZE));
  const rows = [];
  for (const ownerBatch of batches) {
    for (let offset = 0; ; offset += VIGIA_PAGE_SIZE) {
      let query = database.from('v_psi_sales_opportunity_enriched').select(VIGIA_OPPORTUNITY_SELECT).order('updated_at', { ascending: false }).order('id', { ascending: true });
      if (ownerBatch) query = query.in('owner_id', ownerBatch);
      const page = await must(query.range(offset, offset + VIGIA_PAGE_SIZE - 1));
      rows.push(...page);
      if (page.length < VIGIA_PAGE_SIZE) break;
    }
  }
  return rows;
}

app.get('/api/vigia/priorities', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'vigia');
    const database = requireDb();
    const ownerIds = await resolveVigiaOwnerScope(database, currentProfile);
    const scopedRows = await fetchVigiaRows(database, ownerIds);
    const priorities = prioritizeVigiaOpportunities(scopedRows);
    const asOf = scopedRows.map(row => row.updated_at).filter(value => value && !Number.isNaN(new Date(value).getTime())).sort().at(-1) || null;
    res.json({
      generated_at: new Date().toISOString(),
      source: { id: VIGIA_CONFIG.sourceId, label: 'CRM comercial', as_of: asOf },
      policy: { version: VIGIA_CONFIG.version, read_only: true, human_review_required: true },
      totals: {
        source_rows: scopedRows.length,
        visible_active: scopedRows.filter(row => !VIGIA_CONFIG.terminalStages.includes(row.stage_code)).length,
        prioritized: priorities.length,
        high: priorities.filter(row => row.level === 'alto').length,
        medium: priorities.filter(row => row.level === 'medio').length,
        low: priorities.filter(row => row.level === 'bajo').length,
      },
      priorities,
    });
  } catch (error) { sendAuthError(res, error); }
});
app.all('/api/vigia/priorities', (_req, res) => res.status(405).json({ error: 'Método no permitido.' }));

app.get('/api/bootstrap', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const [summary, opportunities, profiles, profileAssignments, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals] = await Promise.all([
      must(database.from('v_psi_sales_pipeline_summary').select('*').order('stage_order')),
      must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).order('updated_at', { ascending: false }).limit(1000)),
      must(database.from('psi_sales_profiles').select(BOOTSTRAP_PROFILE_SELECT).eq('active', true).order('full_name')),
      must(database.from('psi_profile_area_assignments').select('profile_id,area_code,subarea_code')),
      must(database.from('psi_sales_pipeline_stages').select('*').order('stage_order')),
      must(database.from('psi_sales_service_types').select('*').eq('active', true).order('name')),
      must(database.from('psi_sales_loss_reasons').select('*').eq('active', true).order('name')),
      must(database.from('v_psi_sales_stalled_sustentacion').select(opportunitySelect).order('prioritization_date')),
      must(database.from('v_psi_sales_top3_closing').select(opportunitySelect).order('owner_name')),
      must(database.from('v_psi_sales_kpis_by_commercial_month').select('*').order('period_month', { ascending: false }).limit(80)),
      must(database.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500)),
    ]);
    const enrichedOpportunities = await attachCommercialMetadata(database, opportunities);
    const enrichedStalled = await attachCommercialMetadata(database, stalled);
    const enrichedTopClosing = await attachCommercialMetadata(database, topClosing);
    const totals = enrichedOpportunities.reduce((acc, o) => {
      acc.count += 1;
      acc.pipeline += Number(o.offer_value || 0);
      acc.weighted += Number(o.weighted_pipeline_value || 0);
      if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
      return acc;
    }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
    res.json(filterBootstrapForProfile({ summary, opportunities: enrichedOpportunities, profiles, profileAssignments, stages, services, lossReasons, stalled: enrichedStalled, topClosing: enrichedTopClosing, monthlyKpis, goals, totals }, currentProfile));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const id = req.params.id;
    await ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW);
    const opportunity = await attachCommercialMetadata(database, await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single()));
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendError(res, error); }
});


const tenderDocumentBucket = 'tender-documents';
const RUP_MAX_BYTES = 50 * 1024 * 1024;
const tenderDocumentTypes = ['pliego','estudios_previos','anexo_tecnico','adenda','formatos','otro'];
function parseInteractionJson(notes) {
  try { return JSON.parse(notes || '{}'); } catch { return null; }
}
function normalizeDocumentType(value, filename = '') {
  if (tenderDocumentTypes.includes(value)) return value;
  const name = normTenderText(filename);
  if (name.includes('adenda')) return 'adenda';
  if (name.includes('estudio')) return 'estudios_previos';
  if (name.includes('anexo') || name.includes('tecnico')) return 'anexo_tecnico';
  if (name.includes('formato') || name.endsWith('.zip')) return 'formatos';
  if (name.includes('pliego')) return 'pliego';
  return 'otro';
}
function cleanFileName(name) { return String(name || 'documento').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 140); }
async function ensureTenderBucket(database) {
  const existing = await database.storage.getBucket(tenderDocumentBucket);
  if (!existing.error) {
    const currentLimit = Number(existing.data?.file_size_limit || existing.data?.fileSizeLimit || 0);
    if (currentLimit && currentLimit < RUP_MAX_BYTES) {
      const { error: updateError } = await database.storage.updateBucket(tenderDocumentBucket, { public: false, fileSizeLimit: RUP_MAX_BYTES });
      if (updateError) throw updateError;
    }
    return;
  }
  const { error } = await database.storage.createBucket(tenderDocumentBucket, { public: false, fileSizeLimit: RUP_MAX_BYTES });
  if (error && !String(error.message || '').toLowerCase().includes('already')) throw error;
}
async function extractTextFromTenderFile(buffer, filename, mime = '') {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.pdf') || mime.includes('pdf')) {
      const result = await pdfParse(buffer);
      return (result?.text || '').slice(0, 90000);
    }
    if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer });
      return (result?.value || '').slice(0, 90000);
    }
    if (lower.endsWith('.txt') || mime.startsWith('text/')) return buffer.toString('utf8').slice(0, 90000);
    if (lower.endsWith('.zip')) {
      const zip = new AdmZip(buffer);
      const parts = [];
      for (const entry of zip.getEntries().filter(e => !e.isDirectory).slice(0, 30)) {
        const entryName = entry.entryName;
        const data = entry.getData();
        if (/\.(txt|csv|xml|html?)$/i.test(entryName)) parts.push(`--- ${entryName} ---\n${data.toString('utf8').slice(0, 12000)}`);
        else parts.push(`--- ${entryName} ---\nArchivo incluido en ZIP para checklist de formatos.`);
      }
      return parts.join('\n\n').slice(0, 90000);
    }
  } catch (error) {
    return `No fue posible extraer texto automáticamente de ${filename}: ${error?.message || error}`;
  }
  return `Archivo ${filename} cargado. Tipo no soportado para extracción profunda automática.`;
}
function tenderProfileSearchText(companyProfile = {}) {
  return normTenderText(Object.entries(companyProfile || {}).filter(([key]) => !['id','updated_by','updated_at','singleton_key'].includes(key)).map(([, value]) => Array.isArray(value) ? value.join(' ') : String(value || '')).join(' '));
}
function buildTenderGoNoGoVerdict(opportunity, documents, context = {}) {
  const text = context.text || documents.map(d => `\n--- ${d.document_type}: ${d.name} ---\n${d.extracted_text || ''}`).join('\n').slice(0, 220000);
  const normalized = context.normalized || normTenderText(text);
  const companyProfile = context.companyProfile || {};
  const profileText = tenderProfileSearchText(companyProfile);
  const hasPliego = !!context.hasPliego;
  const hasTechnical = !!context.hasTechnical;
  const hasAdenda = !!context.hasAdenda;
  const hasFormats = !!context.hasFormats;
  const finds = context.finds || { smmlv: [], money: [], years: [] };
  const serviceSignals = ['vigilancia','seguridad privada','seguridad fisica','seguridad física','cctv','videovigilancia','monitoreo','control de acceso','alarma','sistema de seguridad','supervision','supervisión'];
  const positiveSignals = serviceSignals.filter(term => normalized.includes(normTenderText(term))).slice(0, 8);
  const profileHits = serviceSignals.filter(term => normalized.includes(normTenderText(term)) && profileText.includes(normTenderText(term))).slice(0, 8);
  const profileGaps = [];
  if (!profileText) profileGaps.push('Ficha/RUP SN no disponible o sin texto suficiente para cruce automático.');
  if (normalized.includes('rup') && !profileText.includes('rup')) profileGaps.push('El proceso menciona RUP; confirmar que la ficha/RUP SN cargada esté vigente y completa.');
  if (finds.smmlv.length && !/(smmlv|experiencia)/.test(profileText)) profileGaps.push('Hay SMMLV/experiencia exigida; falta evidencia automática equivalente en ficha/RUP.');
  if (normalized.includes('capital de trabajo') && !profileText.includes('capital de trabajo')) profileGaps.push('Validar capital de trabajo exigido contra capacidad financiera SN.');
  const blockers = [];
  if (!hasPliego) blockers.push('Falta pliego vigente para validar causales de rechazo.');
  if (!hasTechnical) blockers.push('Falta anexo técnico para validar alcance, puestos, equipos y ANS.');
  const hasCoreFit = positiveSignals.length > 0;
  const urgencyText = opportunity?.expected_close_date ? `Cierre ${opportunity.expected_close_date}` : 'Fecha de cierre por confirmar';
  let finalDecision = 'REVISAR CON LICITACIONES';
  if (blockers.length >= 2) finalDecision = 'NO GO temporal / completar documentos';
  else if (!hasCoreFit) finalDecision = 'DESCARTAR salvo señal comercial externa';
  else if (profileGaps.length >= 2 || finds.smmlv.length) finalDecision = 'GO condicionado a validación RUP/financiera';
  else finalDecision = 'GO condicionado';
  const risk = blockers.length ? 'Alto' : profileGaps.length >= 2 ? 'Medio-Alto' : hasAdenda ? 'Medio' : 'Medio';
  const executive_semaphore = [
    { label: 'Decisión', value: finalDecision, tone: finalDecision.startsWith('GO') ? 'green' : finalDecision.startsWith('DESCARTAR') ? 'red' : 'amber' },
    { label: 'Riesgo', value: risk, tone: risk.includes('Alto') ? 'red' : 'amber' },
    { label: 'Urgencia', value: urgencyText, tone: 'blue' },
    { label: 'Documentos', value: `${documents.length} archivo(s)`, tone: documents.length ? 'green' : 'red' }
  ];
  const commercial_fit = {
    status: hasCoreFit ? 'Encaje detectado' : 'Encaje débil',
    positives: positiveSignals.length ? positiveSignals.map(s => `Objeto/documentos mencionan ${s}.`) : ['No se detectaron términos fuertes de seguridad, vigilancia o tecnología.'],
    concerns: [!hasCoreFit && 'Objeto podría estar fuera del core SN.', hasAdenda && 'Existe adenda: usar versión vigente antes de decidir.'].filter(Boolean)
  };
  const company_profile_crosscheck = {
    status: profileHits.length ? 'Cruce parcial positivo' : profileText ? 'Cruce pendiente/manual' : 'Sin ficha suficiente',
    matches: profileHits.length ? profileHits.map(s => `Documento y ficha/RUP comparten señal: ${s}.`) : ['No hay coincidencias automáticas suficientes; revisar ficha/RUP manualmente.'],
    gaps: profileGaps.length ? profileGaps : ['Cruce automático sin alertas críticas; validar manualmente antes de oferta.'],
    profile_source: companyProfile?.source_document_name || 'Ficha/RUP SN cargada en CRM'
  };
  const habilitating_requirements = [
    { front: 'Jurídico', status: hasPliego ? 'Validar' : 'Pendiente', action: hasPliego ? 'Revisar causales de rechazo, inhabilidades y cronograma.' : 'Cargar/descargar pliego vigente.' },
    { front: 'Técnico', status: hasTechnical ? 'Validar' : 'Pendiente', action: hasTechnical ? 'Extraer alcance, puestos, equipos, ANS y personal mínimo.' : 'Ubicar anexo técnico o especificaciones.' },
    { front: 'Financiero', status: normalized.includes('capital de trabajo') || finds.money.length ? 'Validar contra RUP' : 'Confirmar', action: 'Cruzar capital de trabajo, liquidez, endeudamiento y presupuesto contra ficha SN.' },
    { front: 'Experiencia', status: normalized.includes('experiencia') || finds.smmlv.length ? 'Validar contra RUP' : 'Confirmar', action: finds.smmlv.length ? `Revisar equivalencia de ${finds.smmlv.join(' / ')} en contratos SN.` : 'Confirmar contratos similares exigidos.' },
    { front: 'Formatos y pólizas', status: hasFormats ? 'Cargados/parcial' : 'Pendiente', action: 'Listar formatos obligatorios, póliza de seriedad y anexos firmables.' }
  ];
  const next_action = finalDecision.startsWith('DESCARTAR') ? 'Marcar como descartada si no hay señal comercial adicional.' : blockers.length ? 'Completar documentos críticos y regenerar dictamen.' : 'Enviar a revisión de licitaciones con pliego, anexos y cruce RUP/financiero.';
  const committee_summary = `GO / NO GO SN — ${finalDecision}. ${opportunity.company_name}: ${hasCoreFit ? 'encaje preliminar con servicios SN' : 'encaje comercial débil'}; riesgo ${risk}. ${blockers.length ? `Bloqueadores: ${blockers.join(' ')}` : 'Base documental mínima disponible.'} Siguiente acción: ${next_action}`;
  return { decision: finalDecision, risk, executive_semaphore, commercial_fit, company_profile_crosscheck, habilitating_requirements, blockers, next_action, committee_summary };
}
function buildTenderDocumentAnalysis(opportunity, documents, companyProfile = {}) {
  const text = documents.map(d => `\n--- ${d.document_type}: ${d.name} ---\n${d.extracted_text || ''}`).join('\n').slice(0, 220000);
  const normalized = normTenderText(text);
  const hasPliego = documents.some(d => d.document_type === 'pliego' || normTenderText(d.name).includes('pliego'));
  const hasTechnical = documents.some(d => d.document_type === 'anexo_tecnico' || /anexo|tecnico/i.test(normTenderText(d.name)));
  const hasAdenda = documents.some(d => d.document_type === 'adenda' || normTenderText(d.name).includes('adenda'));
  const hasFormats = documents.some(d => d.document_type === 'formatos');
  const finds = {
    smmlv: Array.from(text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*SMMLV/gi)).slice(0, 5).map(m => m[0]),
    money: Array.from(text.matchAll(/\$\s?[0-9][0-9.]{5,}(?:,[0-9]{1,2})?/g)).slice(0, 5).map(m => m[0]),
    years: Array.from(text.matchAll(/(\d+)\s*años?/gi)).slice(0, 5).map(m => m[0]),
  };
  const signals = [
    normalized.includes('coordinador') ? 'Menciona coordinador / supervisor operativo.' : 'No se detectó coordinador en el texto extraído.',
    normalized.includes('capital de trabajo') ? 'Menciona capital de trabajo.' : 'Validar capital de trabajo en documentos financieros.',
    normalized.includes('rup') ? 'Menciona RUP / experiencia habilitante.' : 'No se detectó RUP en el texto extraído.',
    normalized.includes('cctv') || normalized.includes('videovigilancia') ? 'Incluye componente CCTV / videovigilancia.' : 'No se detectó componente CCTV explícito.',
    normalized.includes('poliza') || normalized.includes('póliza') ? 'Menciona pólizas / seriedad de oferta.' : 'Validar pólizas requeridas.'
  ];
  const missingCritical = [!hasPliego && 'pliego', !hasTechnical && 'anexo técnico'].filter(Boolean);
  const goNoGo = buildTenderGoNoGoVerdict(opportunity, documents, { text, normalized, hasPliego, hasTechnical, hasAdenda, hasFormats, finds, companyProfile });
  const recommendation = goNoGo.decision;
  const risk = goNoGo.risk;
  const matrix = [
    { category: 'Jurídico', status: hasPliego ? 'Cumplimiento por validar' : 'Pendiente', detail: hasPliego ? 'Pliego disponible para revisar causales de rechazo y habilitantes.' : 'Falta pliego vigente.' },
    { category: 'Técnico', status: hasTechnical ? 'Cumplimiento por validar' : 'Pendiente', detail: hasTechnical ? 'Anexo técnico disponible para puestos, ANS, equipos y personal.' : 'Falta anexo técnico vigente.' },
    { category: 'Versiones', status: hasAdenda ? 'Revisión prioritaria' : 'Confirmar', detail: hasAdenda ? 'Hay adenda: usar siempre la versión más reciente.' : 'Confirmar si existen adendas posteriores.' },
    { category: 'Financiero', status: 'Validar', detail: finds.money.length ? `Valores detectados: ${finds.money.join(' · ')}` : 'Extraer presupuesto, indicadores y capital de trabajo.' },
    { category: 'Experiencia', status: 'Validar', detail: finds.smmlv.length ? `SMMLV detectados: ${finds.smmlv.join(' · ')}` : 'Validar experiencia exigida en SMMLV / contratos similares.' },
    { category: 'Formatos', status: hasFormats ? 'Cargados' : 'Pendiente', detail: hasFormats ? 'Formatos disponibles para checklist de entrega.' : 'Cargar formatos anexos antes de ofertar.' },
  ];
  return {
    kind: 'tender_document_analysis', report_title: 'Dictamen GO / NO GO SN', status: 'analisis_generado', recommendation, risk, generated_at: new Date().toISOString(),
    summary: `${recommendation} para ${opportunity.company_name}. ${missingCritical.length ? `Faltan documentos críticos: ${missingCritical.join(', ')}.` : 'Hay base documental mínima para revisión comercial y licitatoria.'} ${hasAdenda ? 'Priorizar Adenda como versión vigente.' : 'Confirmar si existen adendas.'}`,
    findings: signals, detected_values: finds, matrix, go_no_go: goNoGo,
    executive_semaphore: goNoGo.executive_semaphore,
    commercial_fit: goNoGo.commercial_fit,
    company_profile_crosscheck: goNoGo.company_profile_crosscheck,
    habilitating_requirements: goNoGo.habilitating_requirements,
    committee_summary: goNoGo.committee_summary,
    next_action: goNoGo.next_action,
    checklist: [
      'Confirmar versión vigente de pliego/adendas antes de preparar oferta.',
      'Validar experiencia certificada/RUP y equivalencia en SMMLV.',
      'Revisar indicadores financieros: capital de trabajo, liquidez, endeudamiento y rentabilidad.',
      'Confirmar coordinador, supervisores, puestos, turnos, ANS y medios tecnológicos.',
      'Completar formatos obligatorios, pólizas y anexos firmados.'
    ],
    documents: documents.map(d => ({ id: d.id, name: d.name, type: d.document_type, current: d.current }))
  };
}
async function getTenderDocumentRecords(database, opportunityId, { includeSignedUrls = true } = {}) {
  const interactions = await must(database.from('psi_sales_interactions').select('id,notes,occurred_at,created_at,created_by,psi_sales_profiles(full_name)').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento').order('created_at', { ascending: true }));
  const documents = [];
  const analyses = [];
  const importErrors = [];
  for (const row of interactions) {
    const payload = parseInteractionJson(row.notes);
    if (payload?.kind === 'tender_document_upload') documents.push(...(payload.documents || []).map(doc => ({ ...doc, interaction_id: row.id, uploaded_by: row.psi_sales_profiles?.full_name || null })));
    if (payload?.kind === 'tender_document_analysis') analyses.push({ ...payload, interaction_id: row.id, created_at: row.created_at, created_by_name: row.psi_sales_profiles?.full_name || null });
    if (payload?.kind === 'tender_document_import_error') importErrors.push({ kind: payload.kind, source: payload.source || null, created_at: row.created_at, failure_marker: 'fallo_importacion' });
  }
  const signed = includeSignedUrls ? await Promise.all(documents.map(async doc => {
    const { data } = await database.storage.from(tenderDocumentBucket).createSignedUrl(doc.storage_path, 3600);
    return { ...doc, signed_url: data?.signedUrl || null };
  })) : documents;
  return { documents: signed, analysis: analyses.at(-1) || null, analyses, import_error: importErrors.at(-1) || null };
}

function genericTenderOfferDocuments(opportunity, analysis) {
  const sourceLabel = opportunity?.observaciones?.includes('esucontratacion.com') ? 'ESU' : opportunity?.observaciones?.includes('secop') ? 'SECOP' : 'Fuente oficial';
  return [
    { key: 'indice_expediente', name: 'Índice del expediente', folder: '00_Control', status: 'generado_automaticamente', owner: 'Sistema', output: 'Indice_Expediente.docx', reusable: true },
    { key: 'checklist_maestro', name: 'Checklist maestro de documentos', folder: '00_Control', status: 'generado_automaticamente', owner: 'Sistema', output: 'Checklist_Maestro.xlsx', reusable: true },
    { key: 'matriz_cumplimiento', name: 'Matriz de cumplimiento', folder: '00_Control', status: 'generado_automaticamente', owner: 'Sistema', output: 'Matriz_Cumplimiento.xlsx', reusable: true },
    { key: 'resumen_gerencia', name: 'Resumen para gerencia', folder: '00_Control', status: 'generado_automaticamente', owner: 'Sistema', output: 'Resumen_Gerencia.docx', reusable: true },
    { key: 'carta_presentacion', name: 'Carta de presentación', folder: '09_Borradores_IA', status: 'borrador_generado_requiere_revision', owner: 'Licitaciones', output: 'Carta_Presentacion_Borrador.docx', reusable: true },
    { key: 'declaracion_no_inhabilidades', name: 'Declaración de no inhabilidades', folder: '09_Borradores_IA', status: 'borrador_generado_requiere_revision', owner: 'Jurídico', output: 'Declaracion_No_Inhabilidades_Borrador.docx', reusable: true },
    { key: 'solicitud_poliza', name: 'Solicitud de póliza de seriedad a aseguradora', folder: '09_Borradores_IA', status: 'borrador_generado_requiere_revision', owner: 'Jurídico / Aseguradora', output: 'Solicitud_Poliza_Aseguradora.docx', reusable: true },
    { key: 'correo_contabilidad', name: 'Correo a contabilidad con pendientes financieros', folder: '09_Borradores_IA', status: 'borrador_generado_requiere_revision', owner: 'Contabilidad', output: 'Correo_Contabilidad.docx', reusable: true },
    { key: 'correo_juridico', name: 'Correo a jurídico con pendientes legales', folder: '09_Borradores_IA', status: 'borrador_generado_requiere_revision', owner: 'Jurídico', output: 'Correo_Juridico.docx', reusable: true },
    { key: 'propuesta_tecnica_base', name: 'Propuesta técnica base', folder: '09_Borradores_IA', status: analysis?.commercial_fit?.status === 'Encaje detectado' ? 'borrador_generado_requiere_ajuste' : 'pendiente_informacion', owner: 'Operaciones / Comercial', output: 'Propuesta_Tecnica_Base.docx', reusable: false },
    { key: 'documentos_oficiales', name: `Copia de documentos oficiales ${sourceLabel}`, folder: '01_Documentos_Oficiales', status: 'pendiente_sincronizar_sharepoint', owner: 'Sistema', output: 'Documentos oficiales descargados', reusable: false }
  ];
}
function tenderOfferFolderStructure(opportunity) {
  const safeName = String(opportunity?.company_name || 'Licitacion').replace(/[^\p{L}\p{N}\s_-]+/gu, '').trim().slice(0, 80) || 'Licitacion';
  return {
    root_name: `Licitaciones SN/${new Date().getFullYear()}/${safeName}`,
    folders: ['00_Control','01_Documentos_Oficiales','02_Juridico','03_Financiero','04_Tecnico','05_Experiencia','06_Economico','07_Polizas','08_Formatos_Entidad','09_Borradores_IA','10_Final_Para_Revision','11_Presentado']
  };
}
function buildTenderOfferPreparation(opportunity, documents = [], analysis = null, currentProfile = {}) {
  const generic_documents = genericTenderOfferDocuments(opportunity, analysis);
  const auto_generated_documents = generic_documents.filter(doc => doc.status.includes('generado') || doc.status.includes('borrador'));
  const hasAnalysis = !!analysis;
  const human_required_items = [
    { key: 'validar_experiencia', title: 'Seleccionar experiencia específica aplicable', owner: 'Licitaciones / Comercial', priority: 'alta', status: 'requiere_intervencion_humana', reason: 'El sistema puede sugerir contratos, pero la experiencia final debe aprobarse humanamente.' },
    { key: 'validar_financiero', title: 'Confirmar indicadores financieros y capital de trabajo', owner: 'Contabilidad', priority: 'alta', status: 'requiere_intervencion_humana', reason: 'Debe cruzarse contra estados financieros/RUP vigente.' },
    { key: 'poliza_seriedad', title: 'Solicitar y validar póliza de seriedad', owner: 'Jurídico / Aseguradora', priority: 'alta', status: 'requiere_tercero', reason: 'Depende de aseguradora y requiere valor/vigencia correctos.' },
    { key: 'camara_comercio', title: 'Cargar Cámara de Comercio actualizada', owner: 'Jurídico', priority: 'media', status: 'requiere_documento', reason: 'Documento genérico recurrente que debe mantenerse vigente.' },
    { key: 'propuesta_economica', title: 'Definir y aprobar propuesta económica', owner: 'Comercial / Gerencia', priority: 'alta', status: 'requiere_decision', reason: 'El sistema no debe definir valores finales sin aprobación.' },
    { key: 'revision_borradores', title: 'Revisar cartas/declaraciones generadas automáticamente', owner: 'Licitaciones', priority: 'media', status: 'requiere_revision', reason: 'Los borradores IA requieren revisión y firma.' }
  ];
  const assistant_notes = [
    'Generar paquete inicial de preparación automáticamente al aprobar la presentación.',
    'Necesitamos intervención humana para experiencia específica, financieros, póliza, propuesta económica y documentos vencibles.',
    'Los documentos genéricos reutilizables deben mantenerse actualizados y copiarse a cada expediente nuevo.'
  ];
  return {
    kind: 'tender_offer_preparation',
    status: 'preparacion_oferta',
    approved_at: new Date().toISOString(),
    approved_by: currentProfile.full_name || currentProfile.microsoft_email || currentProfile.id || 'Sistema',
    opportunity_id: opportunity.id,
    opportunity_name: opportunity.company_name,
    source_summary: { expected_close_date: opportunity.expected_close_date || null, offer_value: opportunity.offer_value || 0, decision: analysis?.recommendation || analysis?.go_no_go?.decision || 'Preparación aprobada por gerencia' },
    sharepoint_folder: { status: 'pendiente_configurar_integracion', provider: 'SharePoint / OneDrive', url: null, ...tenderOfferFolderStructure(opportunity) },
    generic_documents,
    auto_generated_documents,
    human_required_items,
    assistant_notes,
    checklist_summary: { total: generic_documents.length + human_required_items.length, auto_generated: auto_generated_documents.length, human_required: human_required_items.length, official_documents: documents.length, has_analysis: hasAnalysis },
    control_message: `Paquete inicial de preparación creado: ${auto_generated_documents.length} documentos automáticos y ${human_required_items.length} pendientes humanos críticos.`
  };
}
async function getTenderOfferPreparationRecords(database, opportunityId) {
  const interactions = await must(database.from('psi_sales_interactions').select('id,notes,occurred_at,created_at,created_by,psi_sales_profiles(full_name)').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento').order('created_at', { ascending: true }));
  const preparations = [];
  const notes = [];
  for (const row of interactions) {
    const payload = parseInteractionJson(row.notes);
    if (payload?.kind === 'tender_offer_preparation') preparations.push({ ...payload, interaction_id: row.id, created_at: row.created_at, created_by_name: row.psi_sales_profiles?.full_name || null });
    if (payload?.kind === 'tender_offer_preparation_note') notes.push({ ...payload, interaction_id: row.id, created_at: row.created_at, created_by_name: row.psi_sales_profiles?.full_name || null });
  }
  return { preparation: preparations.at(-1) || null, preparations, notes };
}

async function ensureTenderOpportunity(database, id, profile) {
  await ensureOpportunityAccess(database, id, profile);
  const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single());
  if (opportunity.service_type_code !== 'licitacion_publica') { const error = new Error('La revisión documental aplica solo para oportunidades de licitación pública.'); error.status = 400; throw error; }
  return opportunity;
}


function getTenderSourceUrlFromOpportunity(opportunity) {
  const notes = String(opportunity?.observaciones || '');
  const match = notes.match(/Link fuente:\s*(https?:\/\/\S+)/i);
  return match ? match[1].trim() : '';
}
function noticeUidFromSecopUrl(url) {
  const match = String(url || '').match(/[?&]noticeUID=([^&\s]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}
function secopOfficialUrl(url) {
  const noticeUID = noticeUidFromSecopUrl(url);
  return noticeUID ? `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${noticeUID}` : String(url || '');
}
async function fetchDatosGovJson(url, label) {
  const response = await fetch(url, { headers: { 'User-Agent': 'SN-CRM-SECOP-Documents/1.0 (+https://seguridad-nacional-crm.vercel.app)', 'Accept': 'application/json' } });
  if (!response.ok) throw new Error(`${label} respondió ${response.status}`);
  return await response.json();
}
async function resolveSecopProcessByExactUrl(sourceUrl) {
  const exactUrl = secopOfficialUrl(sourceUrl);
  if (!noticeUidFromSecopUrl(exactUrl)) throw new Error('La oportunidad no tiene enlace SECOP II con noticeUID para importar documentos automáticamente.');
  const params = new URLSearchParams({ '$limit': '1', '$where': `urlproceso='${exactUrl.replace(/'/g, "''")}'` });
  const rows = await fetchDatosGovJson(`${SECOP_PROCESSES_RESOURCE}?${params.toString()}`, 'SECOP II procesos');
  if (!rows?.length) throw new Error(`No se encontró proceso SECOP por urlproceso exacto (${noticeUidFromSecopUrl(exactUrl)}).`);
  return rows[0];
}
async function listSecopDocumentsByPortfolio(portfolioId) {
  if (!portfolioId) throw new Error('El proceso SECOP no trae id_del_portafolio para buscar documentos.');
  const params = new URLSearchParams({ '$limit': '500', proceso: portfolioId });
  const docs = await fetchDatosGovJson(`${SECOP_DOCUMENTS_RESOURCE}?${params.toString()}`, 'SECOP II documentos');
  return (docs || []).filter(d => d?.url_descarga_documento?.url && d?.nombre_archivo);
}
async function downloadSecopDocument(doc, referer) {
  const response = await fetch(doc.url_descarga_documento.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept': 'application/pdf,application/octet-stream,*/*', 'Referer': referer } });
  if (!response.ok) throw new Error(`Documento ${doc.nombre_archivo} respondió ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
function selectPriorityTenderDocuments(docs, nameGetter = d => d?.nombre_archivo || d?.name || '') {
  const priority = ['pliego','estudio','previo','especificacion','especificación','tecnico','técnico','anexo','formato','indicador','financier','experiencia','matriz','riesgo','convocatoria','minuta'];
  const selected = (docs || []).filter(d => priority.some(term => String(nameGetter(d) || '').toLowerCase().includes(term))).slice(0, 40);
  return selected.length ? selected : (docs || []).slice(0, 40);
}
async function listEsuDocumentsFromProcessUrl(sourceUrl) {
  const processUrl = String(sourceUrl || '');
  if (!/^https:\/\/esucontratacion\.com\/procesos\/view\/\d+/i.test(processUrl)) throw new Error('La oportunidad no tiene enlace ESU /procesos/view/<id> para importar documentos automáticamente.');
  const html = await fetchEsuHtml(processUrl);
  const detail = parseEsuProcessDetail(html, processUrl);
  return (detail.documents || []).filter(d => d.url && /\/procesos\/descargar\//i.test(d.url));
}
async function downloadEsuDocument(doc, referer) {
  const response = await fetch(doc.url, { headers: { 'User-Agent': 'SN-CRM-ESU-Documents/1.0', 'Accept': 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/octet-stream,*/*', 'Referer': referer } });
  if (!response.ok) throw new Error(`Documento ${doc.name} respondió ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
function esuDocumentId(doc) {
  const match = String(doc?.url || '').match(/\/procesos\/descargar\/(\d+)/i);
  return match ? `esu-${match[1]}` : createHash('sha256').update(String(doc?.url || doc?.name || Date.now())).digest('hex').slice(0, 16);
}
async function saveTenderDocumentBuffer(database, opportunityId, file, currentProfile, sourceMeta = {}) {
  const name = cleanFileName(file.name);
  const buffer = file.buffer;
  if (!buffer?.length) throw new Error(`Archivo vacío: ${name}`);
  if (buffer.length > RUP_MAX_BYTES) throw new Error(`Archivo supera 50MB: ${name}`);
  const id = createHash('sha256').update(`${opportunityId}:${sourceMeta.source_document_id || ''}:${name}:${buffer.length}`).digest('hex').slice(0, 24);
  const storagePath = `${opportunityId}/${id}-${name}`;
  const documentType = normalizeDocumentType(file.document_type, name);
  const extractedText = await extractTextFromTenderFile(buffer, name, file.mime_type || '');
  const { error: uploadError } = await database.storage.from(tenderDocumentBucket).upload(storagePath, buffer, { contentType: file.mime_type || 'application/octet-stream', upsert: true });
  if (uploadError) throw uploadError;
  return { id, name, size: buffer.length, mime_type: file.mime_type || null, document_type: documentType, current: file.current !== false, storage_path: storagePath, uploaded_at: new Date().toISOString(), extracted_text: extractedText, auto_import: !!sourceMeta.auto_import, source_url: sourceMeta.source_url || null, source_document_id: sourceMeta.source_document_id || null };
}
async function importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze = true } = {}) {
  const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
  const sourceUrl = getTenderSourceUrlFromOpportunity(opportunity);
  const officialUrl = secopOfficialUrl(sourceUrl);
  await ensureTenderBucket(database);
  let sourceLabel = '';
  let sourceContext = {};
  let toDownload = [];
  if (/community\.secop\.gov\.co/i.test(officialUrl)) {
    const process = await resolveSecopProcessByExactUrl(officialUrl);
    const docs = await listSecopDocumentsByPortfolio(process.id_del_portafolio);
    if (!docs.length) throw new Error('SECOP no retornó documentos para este portafolio.');
    sourceLabel = 'SECOP II';
    sourceContext = { source: 'SECOP II', process_id: process.id_del_proceso, portfolio_id: process.id_del_portafolio, notice_uid: noticeUidFromSecopUrl(officialUrl) };
    toDownload = selectPriorityTenderDocuments(docs, d => d.nombre_archivo).map(doc => ({
      name: doc.nombre_archivo,
      mime_type: doc.extensi_n === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      document_type: normalizeDocumentType('', doc.nombre_archivo),
      source_url: doc.url_descarga_documento.url,
      source_document_id: doc.id_documento,
      download: () => downloadSecopDocument(doc, officialUrl),
      errorPrefix: 'SECOP'
    }));
  } else if (/^https:\/\/esucontratacion\.com\/procesos\/view\/\d+/i.test(sourceUrl)) {
    const docs = await listEsuDocumentsFromProcessUrl(sourceUrl);
    if (!docs.length) throw new Error('ESU no retornó documentos descargables para este proceso.');
    sourceLabel = 'ESU Contratación';
    sourceContext = { source: 'ESU Contratación', process_url: sourceUrl, process_id: parseEsuProcessId(sourceUrl) };
    toDownload = selectPriorityTenderDocuments(docs, d => d.name).map(doc => ({
      name: doc.name,
      mime_type: doc.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      document_type: normalizeDocumentType(doc.type, doc.name),
      source_url: doc.url,
      source_document_id: esuDocumentId(doc),
      download: () => downloadEsuDocument(doc, sourceUrl),
      errorPrefix: 'ESU'
    }));
  } else {
    throw new Error('La importación automática solo está disponible para enlaces oficiales SECOP II o ESU Contratación. Use carga manual para otras fuentes.');
  }
  const uploaded = [];
  for (const doc of toDownload) {
    try {
      const buffer = await doc.download();
      uploaded.push(await saveTenderDocumentBuffer(database, opportunityId, { name: doc.name, buffer, mime_type: doc.mime_type, document_type: doc.document_type, current: true }, currentProfile, { auto_import: true, source_url: doc.source_url, source_document_id: doc.source_document_id }));
    } catch (error) {
      const importErrorText = doc.errorPrefix === 'ESU' ? `Error al importar desde ESU: ${error?.message || error}` : `Error al importar desde SECOP: ${error?.message || error}`;
      uploaded.push({ id: `error-${doc.source_document_id}`, name: doc.name, size: 0, mime_type: null, document_type: normalizeDocumentType(doc.document_type, doc.name), current: false, storage_path: null, uploaded_at: new Date().toISOString(), extracted_text: importErrorText, auto_import: true, source_url: doc.source_url || null, source_document_id: doc.source_document_id });
    }
  }
  await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_upload', auto_import: true, ...sourceContext, opportunity: opportunity.company_name, documents: uploaded }) }).select('id').single());
  let analysisGenerated = false;
  if (analyze) {
    const records = await getTenderDocumentRecords(database, opportunityId);
    const currentDocs = records.documents.filter(d => d.current !== false);
    if (currentDocs.length) {
      const companyProfile = await getTenderCompanyProfile(database);
      const analysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);
      await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ ...analysis, auto_import: true, source: sourceLabel }) }).select('id').single());
      analysisGenerated = true;
    }
  }
  const records = await getTenderDocumentRecords(database, opportunityId);
  return {
    ...records,
    imported_count: uploaded.filter(doc => doc.current !== false).length,
    failed_count: uploaded.filter(doc => doc.current === false).length,
    analysis_generated: analysisGenerated && Boolean(records.analysis)
  };
}
async function convertTenderToOpportunity(database, tender, currentProfile) {
  if (!tender?.source || !tender?.entity || !tender?.title) throw new Error('Licitación inválida para convertir.');
  if (!(await tenderTableAvailable(database))) throw new Error('La tabla psi_public_tenders aún no existe. Aplica la migración para convertir licitaciones.');
  const owner = await findTenderOwner(database, currentProfile);
  const payload = buildTenderOpportunityPayload(tender, currentProfile.role === 'comercial' ? currentProfile : owner);
  const tenderRecord = await getPersistedTenderByStableKey(database, stableTenderKey(tender));
  const conversion = await callTenderOpportunityConversion(database, tenderRecord.id, payload, tenderRecord.tracking_updated_at, currentProfile);
  const opportunityId = conversion.opportunity_id;
  let document_import_status = 'no_aplica';
  let document_import_error = null;
  if ((tender.source === 'SECOP II' || tender.source === 'ESU Contratación') && tender.url) {
    try {
      const importResult = await importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze: true });
      document_import_status = importResult.analysis_generated ? 'analisis_generado' : 'fallo_importacion';
      if (!importResult.analysis_generated) {
        document_import_error = `No se pudo generar análisis: ${importResult.imported_count} documentos vigentes, ${importResult.failed_count} fallidos.`;
        await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_import_error', auto_import: true, source: tender.source, error: document_import_error }) }).select('id').single());
      }
    } catch (error) {
      document_import_status = 'fallo_importacion';
      document_import_error = error?.message || String(error);
      await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_import_error', auto_import: true, source: tender.source, error: document_import_error }) }).select('id').single());
    }
  }
  return { id: opportunityId, duplicate: !!conversion.duplicate, document_import_status, document_import_error };
}
async function markTenderOpportunityDiscarded(database, opportunityId, currentProfile, reason) {
  await ensureTenderOpportunity(database, opportunityId, currentProfile);
  const notes = String(reason || 'Descartada después de revisión documental / comercial.').trim();
  const { data: tender, error } = await database.from('psi_public_tenders')
    .select('id,tracking_updated_at')
    .eq('converted_opportunity_id', opportunityId)
    .maybeSingle();
  if (error) throw error;
  return await callTenderOpportunityDiscard(database, opportunityId, {
    note: notes,
    expected_tracking_updated_at: tender?.tracking_updated_at ?? null,
  }, currentProfile);
}

export async function buildTenderDossierSummary(database, tender) {
  const fallback = {
    ...dbTenderToPublic(tender),
    opportunity_id: tender.converted_opportunity_id,
    document_count: 0,
    missing_document_count: 0,
    document_import_status: 'error',
    document_import_error: null,
    go_no_go: 'Pendiente',
    risk: 'Pendiente',
    checklist_progress: null,
    preparation_status: 'pendiente',
    human_pending_count: 0,
    sharepoint_status: 'pendiente',
    sharepoint_url: null,
    dossier_error: 'No se pudo cargar el expediente.'
  };
  try {
    const records = await getTenderDocumentRecords(database, tender.converted_opportunity_id, { includeSignedUrls: false });
    const preparationRecords = await getTenderOfferPreparationRecords(database, tender.converted_opportunity_id);
    const currentDocuments = records.documents.filter(document => document.current !== false);
    const analysis = records.analysis?.status === 'analisis_generado' ? records.analysis : null;
    const importFailureIsCurrent = records.import_error && (!analysis || !analysis.created_at || !records.import_error.created_at || Date.parse(records.import_error.created_at) >= Date.parse(analysis.created_at));
    const preparation = preparationRecords.preparation;
    return {
      ...fallback,
      document_count: currentDocuments.length,
      missing_document_count: (analysis?.checklist || []).filter(item => /pendiente|falta/i.test(String(item))).length,
      document_import_status: importFailureIsCurrent ? 'fallo_importacion' : analysis ? 'analisis_generado' : currentDocuments.length ? 'documentos_cargados' : 'pendiente_documentos',
      document_import_error: importFailureIsCurrent ? 'La importación automática de documentos falló. Reintente o cargue los documentos manualmente.' : null,
      go_no_go: importFailureIsCurrent ? 'Pendiente' : analysis?.go_no_go?.decision || analysis?.recommendation || 'Pendiente',
      risk: importFailureIsCurrent ? 'Pendiente' : analysis?.go_no_go?.risk || analysis?.risk || 'Pendiente',
      checklist_progress: preparation?.checklist_summary || null,
      preparation_status: preparation?.status || 'pendiente',
      human_pending_count: preparation?.human_required_items?.length || 0,
      sharepoint_status: preparation?.sharepoint_folder?.status || 'pendiente',
      sharepoint_url: preparation?.sharepoint_folder?.url || null,
      dossier_error: null
    };
  } catch (_error) {
    return fallback;
  }
}

const tenderDossierDefaultLimit = 50;
const tenderDossierMaxLimit = 100;
const tenderDossierMaxOffset = 10000;
function parseTenderDossierPage(query = {}) {
  const parse = (value, fallback, maximum, label) => {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(String(value))) { const error = new Error(`${label} debe ser un entero positivo.`); error.status = 400; throw error; }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) { const error = new Error(`${label} debe estar entre 0 y ${maximum}.`); error.status = 400; throw error; }
    return parsed;
  };
  const limit = parse(query.limit, tenderDossierDefaultLimit, tenderDossierMaxLimit, 'El límite');
  if (limit < 1) { const error = new Error(`El límite debe estar entre 1 y ${tenderDossierMaxLimit}.`); error.status = 400; throw error; }
  return { limit, offset: parse(query.offset, 0, tenderDossierMaxOffset, 'El desplazamiento') };
}

app.get('/api/tender-dossiers', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const database = requireDb();
    const { limit, offset } = parseTenderDossierPage(req.query);
    const tenders = await must(database.from('psi_public_tenders').select('*').not('converted_opportunity_id', 'is', null).order('tracking_updated_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + limit - 1));
    const dossiers = [];
    for (const tender of tenders || []) dossiers.push(await buildTenderDossierSummary(database, tender));
    res.set('X-Dossier-Limit', String(limit));
    res.set('X-Dossier-Offset', String(offset));
    res.json(dossiers);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-offer-preparation', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.query.id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    res.json(await getTenderOfferPreparationRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-offer-preparation-approve', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const documentRecords = await getTenderDocumentRecords(database, opportunityId);
    const preparation = buildTenderOfferPreparation(opportunity, documentRecords.documents.filter(d => d.current !== false), documentRecords.analysis, currentProfile);
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify(preparation) }).select('id').single());
    await database.from('psi_sales_opportunities').update({ next_action_at: opportunity.expected_close_date || null }).eq('id', opportunityId).select('id').single();
    res.status(201).json(await getTenderOfferPreparationRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-offer-preparation-note', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const note = String(req.body.note || '').trim();
    if (!note) throw new Error('La nota para el asistente es obligatoria.');
    const payload = { kind: 'tender_offer_preparation_note', note, status: req.body.status || 'abierta', created_at: new Date().toISOString(), created_by: currentProfile.full_name || currentProfile.microsoft_email || currentProfile.id, purpose: 'Notas para el asistente / comercial: informar qué necesitamos del humano para seguir adelante.' };
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify(payload) }).select('id').single());
    res.status(201).json(await getTenderOfferPreparationRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-documents', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, id, currentProfile);
    res.json(await getTenderDocumentRecords(database, id));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    if (!files.length) throw new Error('Debe adjuntar al menos un documento.');
    await ensureTenderBucket(database);
    const uploaded = [];
    for (const file of files.slice(0, 8)) {
      const name = cleanFileName(file.name);
      const buffer = Buffer.from(String(file.content_base64 || ''), 'base64');
      if (!buffer.length) throw new Error(`Archivo vacío: ${name}`);
      if (buffer.length > RUP_MAX_BYTES) throw new Error(`Archivo supera 50MB: ${name}`);
      uploaded.push(await saveTenderDocumentBuffer(database, opportunityId, { name, buffer, mime_type: file.mime_type || '', document_type: file.document_type, current: file.current }, currentProfile));
    }
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_upload', opportunity: opportunity.company_name, documents: uploaded }) }).select('id').single());
    res.status(201).json(await getTenderDocumentRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-analyze', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const records = await getTenderDocumentRecords(database, opportunityId);
    const currentDocs = records.documents.filter(d => d.current !== false);
    if (!currentDocs.length) throw new Error('Debe cargar documentos antes de analizar.');
    const companyProfile = await getTenderCompanyProfile(database);
    const analysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify(analysis) }).select('id').single());
    res.json(await getTenderDocumentRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});


app.post('/api/tender-documents-import', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await importTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze: true }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-opportunity-discard', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await markTenderOpportunityDiscarded(database, opportunityId, currentProfile, req.body.reason));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

function cleanOpportunity(body) {
  const payload = {
    company_name: String(body.company_name || '').trim(),
    owner_id: body.owner_id || null,
    economic_sector: body.economic_sector || null,
    decision_maker_name: body.decision_maker_name || null,
    decision_maker_email: body.decision_maker_email || null,
    decision_maker_phone: body.decision_maker_phone || null,
    quote_city: body.quote_city || null,
    quote_date: body.quote_date || null,
    offer_value: Number(body.offer_value || 0),
    service_type_code: body.service_type_code || null,
    stage_code: body.stage_code || 'prospecto',
    loss_reason_code: body.stage_code === 'perdido' ? body.loss_reason_code : null,
    loss_notes: body.loss_notes || null,
    next_action_at: body.next_action_at || null,
    expected_close_date: body.expected_close_date || null,
    commission_rate: Number(body.commission_rate || 0),
    regional_nombre: body.regional_nombre || null,
    sede: body.sede || null,
    tipo_producto_original: body.tipo_producto_original || null,
    observaciones: body.observaciones || null,
    customer_segment: validateCustomerSegment(body.customer_segment, true),
    external_source: body.external_source || 'web_mvp'
  };
  if (!payload.company_name) throw new Error('El cliente / empresa es obligatorio.');
  if (!payload.owner_id) throw new Error('El comercial responsable es obligatorio.');
  if (!payload.stage_code) throw new Error('La etapa es obligatoria.');
  if (!payload.service_type_code) throw new Error('El tipo de servicio es obligatorio.');
  if (Number.isNaN(payload.offer_value) || payload.offer_value < 0) throw new Error('El valor debe ser numérico y positivo.');
  if (payload.stage_code === 'perdido' && !payload.loss_reason_code) throw new Error('Si la oportunidad está perdida, debe registrar motivo de pérdida.');
  return payload;
}

app.post('/api/opportunities', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    await requireOpportunityAction(database, currentProfile, payload.owner_id, ACTIONS.CRM_OPPORTUNITY_CREATE);
    const data = await must(database.from('psi_sales_opportunities').insert(payload).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.put('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const existing = await ensureOpportunityAccess(database, req.params.id, currentProfile, ACTIONS.CRM_OPPORTUNITY_EDIT);
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    if (payload.owner_id !== existing.owner_id) await requireOpportunityAction(database, currentProfile, payload.owner_id, ACTIONS.CRM_OPPORTUNITY_REASSIGN);
    if ((payload.customer_segment || null) !== (existing.customer_segment || null) && !canEditCustomerSegment(currentProfile, existing)) { const error = new Error('No tiene permiso para cambiar Cliente Nuevo / Cliente Actual en oportunidades ya creadas.'); error.status = 403; throw error; }
    const data = await must(database.from('psi_sales_opportunities').update(payload).eq('id', req.params.id).select('id').single());
    await logCustomerSegmentChange(database, req.params.id, currentProfile.id, existing.customer_segment, payload.customer_segment);
    res.json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

function normalizePeriodMonth(value) {
  const raw = String(value || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) throw new Error('Debe seleccionar año y mes válidos.');
  return `${raw}-01`;
}

function cleanGoal(body) {
  const payload = {
    user_id: body.user_id || null,
    period_month: normalizePeriodMonth(body.period_month),
    service_type_code: body.service_type_code || null,
    regional_nombre: body.regional_nombre || null,
    operational_unit_target: Number(body.operational_unit_target || 0),
    sales_budget: Number(body.sales_budget || 0),
    prospect_target: Number(body.prospect_target || 0),
    quote_target: Number(body.quote_target || 0),
  };
  if (!payload.user_id) throw new Error('Debe seleccionar un asesor comercial.');
  if (!payload.service_type_code) throw new Error('Debe seleccionar el producto / servicio de la meta.');
  for (const [key, value] of Object.entries(payload)) {
    if (['sales_budget','prospect_target','quote_target','operational_unit_target'].includes(key) && (Number.isNaN(value) || Number(value) < 0)) {
      throw new Error('Las metas deben ser numéricas y positivas.');
    }
  }
  payload.regional_nombre = payload.regional_nombre || 'todas';
  return payload;
}

app.get('/api/goals', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'goals');
    const database = requireDb();
    let query = database.from('psi_sales_goals').select('*').order('period_month', { ascending: false }).limit(500);
    if (currentProfile.role === 'comercial') query = query.or(`user_id.eq.${currentProfile.id},user_id.is.null`);
    const data = await must(query);
    if (currentProfile.role !== 'director') return res.json(data);
    const assignmentRows = await must(database.from('psi_profile_area_assignments').select('profile_id,area_code,subarea_code'));
    const ownerAssignments = assignmentsByProfile(assignmentRows);
    res.json(data.filter(goal => goal.user_id && canReadCrmRow(currentProfile, { owner_id: goal.user_id }, ownerAssignments)));
  } catch (error) { sendAuthError(res, error); }
});

app.put('/api/goals', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'goals');
    if (!globalCrmScopeRoles.has(currentProfile?.role)) { const error = new Error('Solo gerencia/admin puede modificar metas.'); error.status = 403; throw error; }
    const database = requireDb();
    const payload = cleanGoal(req.body);
    const data = await must(database.from('psi_sales_goals').upsert(payload, { onConflict: 'user_id,period_month,service_type_code,regional_nombre' }).select('*').single());
    res.json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/opportunities/:id/interactions', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    await ensureOpportunityAccess(database, req.params.id, currentProfile, ACTIONS.CRM_OPPORTUNITY_EDIT);
    const notes = String(req.body.notes || '').trim();
    if (!notes) throw new Error('La nota del seguimiento es obligatoria.');
    const occurred_at = req.body.occurred_at || new Date().toISOString();
    const interaction_type = req.body.interaction_type || 'nota';
    const created_by = globalCrmScopeRoles.has(currentProfile?.role) ? (req.body.created_by || currentProfile.id) : currentProfile.id;
    const next_action_at = req.body.next_action_at || null;
    const row = { opportunity_id: req.params.id, notes, occurred_at, interaction_type, created_by };
    const data = await must(database.from('psi_sales_interactions').insert(row).select('id').single());
    const update = { last_interaction_at: occurred_at };
    if (next_action_at) update.next_action_at = next_action_at;
    await must(database.from('psi_sales_opportunities').update(update).eq('id', req.params.id).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
});


// Vercel-safe single-segment aliases. The catch-all function reliably serves /api/bootstrap,
// but nested URLs like /api/opportunities/:id can resolve to Vercel 404 in production.
app.get('/api/opportunity-detail', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW);
    const opportunity = await attachCommercialMetadata(database, await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single()));
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendError(res, error); }
});

app.put('/api/opportunity', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    const existing = await ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_EDIT);
    const payload = cleanOpportunity(req.body);
    if (currentProfile.role === 'comercial') payload.owner_id = currentProfile.id;
    if (payload.owner_id !== existing.owner_id) await requireOpportunityAction(database, currentProfile, payload.owner_id, ACTIONS.CRM_OPPORTUNITY_REASSIGN);
    if ((payload.customer_segment || null) !== (existing.customer_segment || null) && !canEditCustomerSegment(currentProfile, existing)) { const error = new Error('No tiene permiso para cambiar Cliente Nuevo / Cliente Actual en oportunidades ya creadas.'); error.status = 403; throw error; }
    const data = await must(database.from('psi_sales_opportunities').update(payload).eq('id', id).select('id').single());
    await logCustomerSegmentChange(database, id, currentProfile.id, existing.customer_segment, payload.customer_segment);
    res.json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/opportunity-interactions', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const id = String(req.query.id || '');
    if (!id) throw new Error('Debe indicar la oportunidad.');
    await ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_EDIT);
    const notes = String(req.body.notes || '').trim();
    if (!notes) throw new Error('La nota del seguimiento es obligatoria.');
    const occurred_at = req.body.occurred_at || new Date().toISOString();
    const interaction_type = req.body.interaction_type || 'nota';
    const created_by = globalCrmScopeRoles.has(currentProfile?.role) ? (req.body.created_by || currentProfile.id) : currentProfile.id;
    const next_action_at = req.body.next_action_at || null;
    const row = { opportunity_id: id, notes, occurred_at, interaction_type, created_by };
    const data = await must(database.from('psi_sales_interactions').insert(row).select('id').single());
    const update = { last_interaction_at: occurred_at };
    if (next_action_at) update.next_action_at = next_action_at;
    await must(database.from('psi_sales_opportunities').update(update).eq('id', id).select('id').single());
    res.status(201).json(data);
  } catch (error) { sendError(res, error, error?.status || 400); }
});



async function findAuthUserByEmail(database, email) {
  const { data: usersData, error } = await database.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function confirmAuthUserIfNeeded(database, user) {
  if (!user || user.email_confirmed_at || user.confirmed_at) return user;
  const { data, error } = await database.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (error) throw error;
  return data?.user || user;
}

export async function ensureProfileAuthAfterCommit(database, { targetProfileId, email, password, userMetadata, active, sendInvite, req }) {
  const result = { invited: false, accessLink: null, authWarning: null };
  if (!active || (!sendInvite && !password)) return result;
  try {
    let authUser = await findAuthUserByEmail(database, email);
    const existed = Boolean(authUser);
    if (!authUser) {
      const attributes = { email, email_confirm: false, user_metadata: userMetadata };
      if (password) attributes.password = password;
      const { data, error } = await database.auth.admin.createUser(attributes);
      if (error && !/already|registered|exists/i.test(error.message)) throw error;
      authUser = data?.user || await findAuthUserByEmail(database, email);
    }
    if (!authUser?.id) throw new Error('No se pudo identificar el sujeto Auth aprovisionado.');
    const { data: bound, error: bindError } = await database.rpc('psi_admin_bind_profile_auth', {
      p_profile_id: targetProfileId,
      p_expected_email: email,
      p_auth_user_id: authUser.id,
    });
    if (bindError) throw bindError;
    if (bound !== true) {
      result.authWarning = 'El perfil cambió después de guardarse; la provisión de acceso quedó obsoleta y no se envió ningún enlace.';
      return result;
    }
    await confirmAuthUserIfNeeded(database, authUser);
    // Existing identities are never overwritten. Password changes use a user-controlled recovery link.
    if (sendInvite || (password && existed)) {
      const emailResult = await sendAccessEmail(database, email, req);
      if (emailResult.error) console.error('Supabase access email failed', emailResult.error);
      result.invited = emailResult.sent;
    }
    if (sendInvite) result.accessLink = await generateAccessLink(database, email, req, userMetadata);
  } catch (error) {
    console.error('Post-commit Auth provisioning failed', error);
    result.authWarning = 'El perfil quedó guardado, pero el acceso no pudo aprovisionarse. Reintente el envío desde Usuarios y permisos.';
  }
  return result;
}

async function generateAccessLink(database, email, req, userMetadata = {}) {
  const { data, error } = await database.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: getPublicAppUrl(req), data: userMetadata }
  });
  if (error) return null;
  return data?.properties?.action_link || data?.action_link || null;
}

async function sendAccessEmail(database, email, req) {
  const { error } = await database.auth.resetPasswordForEmail(email, { redirectTo: getPublicAppUrl(req) });
  return { sent: !error, error };
}

app.get('/api/access-catalog', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'users');
    requireAction(currentProfile, ACTIONS.USERS_MANAGE, {});
    res.json(await getActiveAccessCatalog(requireDb()));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'users');
    requireAction(currentProfile, ACTIONS.USERS_MANAGE, {});
    const database = requireDb();
    let profiles;
    try {
      profiles = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment,created_at').order('full_name'));
      if (!Array.isArray(profiles)) throw new Error('Perfiles inválidos.');
    } catch (error) { throw profileAccessReadFailure(error); }
    const ids = profiles.map(profile => profile?.id);
    if (ids.some(id => !isExactNonblankString(id)) || new Set(ids).size !== ids.length) throw profileAccessReadFailure(new Error('Perfiles inválidos.'));
    if (!ids.length) return res.json([]);
    let assignmentRows; let permissionRows;
    try {
      [assignmentRows, permissionRows] = await Promise.all([
        must(database.from('psi_profile_area_assignments').select('profile_id,area_code,subarea_code').in('profile_id', ids)),
        must(database.from('psi_profile_permissions').select('profile_id,permission_code').in('profile_id', ids)),
      ]);
      res.json(enrichProfilesWithAccess(profiles, assignmentRows, permissionRows));
    } catch (error) { throw profileAccessReadFailure(error); }
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'users');
    requireAction(currentProfile, ACTIONS.USERS_MANAGE, {});
    const database = requireDb();
    const full_name = String(req.body.full_name || '').trim();
    const microsoft_email = String(req.body.microsoft_email || '').trim().toLowerCase();
    const role = normalizeUserRole(req.body.role);
    const password = String(req.body.password || '');
    const active = req.body.active !== false;
    const send_invite = req.body.send_invite !== false;
    const can_edit_customer_segment = req.body.can_edit_customer_segment === true;
    if (!full_name) throw new Error('El nombre completo es obligatorio.');
    if (!microsoft_email || !microsoft_email.includes('@')) throw new Error('Debe registrar un email válido.');
    if (!PROFILE_ROLES.has(role)) throw new Error('Rol no válido.');
    if (password && password.length < 8) throw new Error('La clave temporal debe tener mínimo 8 caracteres.');
    const access = normalizeProfileAccessRequest(req.body, await getActiveAccessCatalog(database), role);
    const commercial_area = legacyCommercialAreaFromAssignments(access.areas);
    const userMetadata = { full_name, role };
    let beforeProfile;
    try {
      beforeProfile = await must(database.from('psi_sales_profiles').select(profileAdminSelect).eq('microsoft_email', microsoft_email).maybeSingle());
    } catch (error) { throw profileAdministrationFailure(error); }
    assertNoAdminSelfLockout(currentProfile, { profileId: beforeProfile?.id, microsoftEmail: microsoft_email, role, active, permissions: access.permissions });
    const beforeAccess = beforeProfile ? await readProfileAccess(database, beforeProfile.id) : { areas: [], permissions: [], areaRows: [], permissionRows: [] };
    const operationId = await acquireProfileAdministrationLock(database, currentProfile.id);
    let row;
    try {
      row = await persistProfileAccessChange(database, { mode: 'post', targetId: beforeProfile?.id || null, beforeProfile, profileValues: { full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment }, beforeAccess, afterAccess: access, actorProfileId: currentProfile.id, operationId });
    } finally {
      await releaseProfileAdministrationLock(database, operationId, currentProfile.id);
    }
    const authResult = await ensureProfileAuthAfterCommit(database, { targetProfileId: row.id, email: microsoft_email, password, userMetadata, active, sendInvite: send_invite, req });
    res.status(201).json({ ...row, ...access, invited: authResult.invited, access_link: authResult.accessLink, auth_warning: authResult.authWarning });
  } catch (error) { sendAuthError(res, error); }
});

app.patch('/api/users', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'users');
    requireAction(currentProfile, ACTIONS.USERS_MANAGE, {});
    const database = requireDb();
    const id = String(req.query.id || '').trim();
    const existingProfile = await must(database.from('psi_sales_profiles').select('id,full_name,microsoft_email,role,active,commercial_area,can_edit_customer_segment').eq('id', id).single());
    if (!existingProfile) { const error = new Error('Usuario no encontrado.'); error.status = 404; throw error; }
    const full_name = String(req.body.full_name || '').trim();
    const microsoft_email = String(req.body.microsoft_email || '').trim().toLowerCase();
    const role = normalizeUserRole(req.body.role);
    const password = String(req.body.password || '');
    const active = req.body.active !== false;
    const send_invite = req.body.send_invite === true;
    const can_edit_customer_segment = req.body.can_edit_customer_segment === true;
    if (!full_name) throw new Error('El nombre completo es obligatorio.');
    if (!microsoft_email || !microsoft_email.includes('@')) throw new Error('Debe registrar un email válido.');
    if (microsoft_email !== String(existingProfile.microsoft_email || '').trim().toLowerCase()) {
      const error = new Error('El correo del perfil es inmutable. Cree un usuario nuevo para otra identidad.');
      error.status = 409;
      error.code = 'PROFILE_EMAIL_IMMUTABLE';
      throw error;
    }
    if (!PROFILE_ROLES.has(role)) throw new Error('Rol no válido.');
    if (password && password.length < 8) throw new Error('La clave temporal debe tener mínimo 8 caracteres.');
    const access = normalizeProfileAccessRequest(req.body, await getActiveAccessCatalog(database), role);
    assertNoAdminSelfLockout(currentProfile, { profileId: id, microsoftEmail: microsoft_email, role, active, permissions: access.permissions });
    const beforeAccess = await readProfileAccess(database, id);
    const commercial_area = legacyCommercialAreaFromAssignments(access.areas);
    const userMetadata = { full_name, role };
    const operationId = await acquireProfileAdministrationLock(database, currentProfile.id);
    let row;
    try {
      row = await persistProfileAccessChange(database, { mode: 'patch', targetId: id, beforeProfile: existingProfile, profileValues: { full_name, microsoft_email, role, active, commercial_area, can_edit_customer_segment }, beforeAccess, afterAccess: access, actorProfileId: currentProfile.id, operationId });
    } finally {
      await releaseProfileAdministrationLock(database, operationId, currentProfile.id);
    }
    const authResult = await ensureProfileAuthAfterCommit(database, { targetProfileId: row.id, email: microsoft_email, password, userMetadata, active, sendInvite: send_invite, req });
    res.json({ ...row, ...access, invited: authResult.invited, access_link: authResult.accessLink, auth_warning: authResult.authWarning });
  } catch (error) { sendAuthError(res, error); }
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));

if (!process.env.VERCEL) {
  const port = process.env.PORT || 4173;
  app.listen(port, () => console.log(`CRM Comercial SN escuchando en http://localhost:${port}`));
}

export default app;
