import { isModulePermissionEligible } from './module-access.js';

const HUMAN_ROLES = new Set([
  'admin',
  'gerencia',
  'director',
  'comercial',
  'colaborador',
  'junta',
]);

export const ACTIONS = Object.freeze({
  USERS_MANAGE: 'users.manage',
  NAV_GERENCIAL_VIEW: 'nav.gerencial.view',
  NAV_COMERCIAL_VIEW: 'nav.comercial.view',
  NAV_LICITACIONES_VIEW: 'nav.licitaciones.view',
  CRM_PIPELINE_SUMMARY_VIEW: 'crm.pipeline.summary.view',
  CRM_OPPORTUNITY_DETAIL_VIEW: 'crm.opportunity.detail.view',
  CRM_OPPORTUNITY_CREATE: 'crm.opportunity.create',
  CRM_OPPORTUNITY_EDIT: 'crm.opportunity.edit',
  CRM_OPPORTUNITY_REASSIGN: 'crm.opportunity.reassign',
  LICITACIONES_VIEW: 'licitaciones.view',
  LICITACIONES_WORKBENCH_USE: 'licitaciones.workbench.use',
  LICITACIONES_WORKBENCH_CUSTODY: 'licitaciones.workbench.custody',
  LICITACIONES_CONVERT: 'licitaciones.convert',
  LICITACIONES_CONFIGURE: 'licitaciones.configure',
  LICITACIONES_COMPANY_PROFILE_UPDATE: 'licitaciones.company_profile.update',
  LICITACIONES_SYNC: 'licitaciones.sync',
  LICITACIONES_DISCARD_PROPOSE: 'licitaciones.discard.propose',
  LICITACIONES_DISCARD_APPROVE: 'licitaciones.discard.approve',
  LICITACIONES_GO_NO_GO_RECOMMEND: 'licitaciones.go_no_go.recommend',
  LICITACIONES_GO_NO_GO_APPROVE: 'licitaciones.go_no_go.approve',
  SIIO_AREA_VIEW: 'siio.area.view',
  SIIO_SUBJECT_CREATE: 'siio.subject.create',
  SIIO_SUBJECT_EDIT: 'siio.subject.edit',
  SIIO_ASSIGNMENT_VIEW: 'siio.assignment.view',
  SIIO_ASSIGNMENT_UPDATE: 'siio.assignment.update',
  SIIO_CLOSE_REQUEST: 'siio.close.request',
  SIIO_CLOSE_APPROVE: 'siio.close.approve',
  BOARD_PUBLICATION_VIEW: 'board.publication.view',
  BOARD_DRAFT_EDIT: 'board.draft.edit',
  BOARD_APPROVE: 'board.approve',
  BOARD_PUBLISH: 'board.publish',
  AI_ANALYSIS_RUN: 'ai.analysis.run',
  AI_COMMERCIAL_DRAFT_RUN: 'ai.commercial_draft.run',
  MODULE_SIIO_VIEW: 'module.siio.view',
  MODULE_VIGIA_VIEW: 'module.vigia.view',
  MODULE_DASHBOARD_VIEW: 'module.dashboard.view',
  MODULE_ALERTS_VIEW: 'module.alerts.view',
  MODULE_OPPORTUNITIES_VIEW: 'module.opportunities.view',
  MODULE_GOALS_VIEW: 'module.goals.view',
  MODULE_USERS_VIEW: 'module.users.view',
});

const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));
const TENDER_PERMISSION = 'licitaciones';
const TENDER_CUSTODY_PERMISSION = 'licitaciones_custodia';
const TENDER_COMPANY_PERMISSION = 'licitaciones_empresa';
const HUMAN_TENDER_ROLES = new Set(['admin', 'gerencia', 'director', 'comercial']);
const PRIVILEGED_ROLES = new Set(['admin', 'gerencia']);
const EXPLICIT_SCOPE_ROLES = new Set(['director', 'comercial', 'colaborador']);
const DIRECTOR_ROLE = new Set(['director']);
const COMMERCIAL_ROLES = new Set(['comercial']);
const COMMERCIAL_OR_COLLABORATOR_ROLES = new Set(['comercial', 'colaborador']);
const ADMIN_ROLE = new Set(['admin']);
const BOARD_ROLE = new Set(['junta']);

const hasOwn = (value, key) => Object.hasOwn(value, key);
const isRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const isCode = (value) => typeof value === 'string' && value.trim() === value && value.length > 0;
const isId = (value) => typeof value === 'string' && value.trim() === value && value.length > 0;

function isActiveIdentity(profile) {
  return isRecord(profile)
    && hasOwn(profile, 'active')
    && profile.active === true
    && hasOwn(profile, 'id')
    && isId(profile.id);
}

function isAgent(profile) {
  return isActiveIdentity(profile)
    && hasOwn(profile, 'identity_type')
    && profile.identity_type === 'agent';
}

function isHuman(profile) {
  return isActiveIdentity(profile)
    && (!hasOwn(profile, 'identity_type') || profile.identity_type == null || profile.identity_type === 'human')
    && hasOwn(profile, 'role')
    && typeof profile.role === 'string'
    && HUMAN_ROLES.has(profile.role);
}

function hasHumanRole(profile, roles) {
  return isHuman(profile) && roles.has(profile.role);
}

function ownArray(profile, key) {
  return isActiveIdentity(profile) && hasOwn(profile, key) && Array.isArray(profile[key])
    ? profile[key]
    : null;
}

function ownArrayValues(array) {
  const values = [];
  for (let index = 0; index < array.length; index += 1) {
    if (hasOwn(array, index)) values.push(array[index]);
  }
  return values;
}

function validAssignment(assignment) {
  return isRecord(assignment)
    && hasOwn(assignment, 'area_code')
    && isCode(assignment.area_code)
    && hasOwn(assignment, 'subarea_code')
    && (assignment.subarea_code === null || isCode(assignment.subarea_code));
}

function assignments(profile) {
  const areas = ownArray(profile, 'areas');
  return areas === null ? [] : ownArrayValues(areas).filter(validAssignment);
}

function hasAnyArea(profile) {
  return assignments(profile).length > 0;
}

function hasAssignedArea(profile, areaCode) {
  for (const assignment of assignments(profile)) {
    if (assignment.area_code === areaCode) return true;
  }
  return false;
}

function isScopedHuman(profile, areaCode, subareaCode = null) {
  if (!isHuman(profile) || !isCode(areaCode) || (subareaCode !== null && !isCode(subareaCode))) {
    return false;
  }
  if (PRIVILEGED_ROLES.has(profile.role)) return true;
  if (!EXPLICIT_SCOPE_ROLES.has(profile.role)) return false;
  for (const assignment of assignments(profile)) {
    if (assignment.area_code !== areaCode) continue;
    if (assignment.subarea_code === null) return true;
    if (subareaCode !== null && assignment.subarea_code === subareaCode) return true;
  }
  return false;
}

function hasAreaResource(resource, expectedArea = null) {
  return isRecord(resource)
    && hasOwn(resource, 'area_code')
    && isCode(resource.area_code)
    && (expectedArea === null || resource.area_code === expectedArea)
    && (!hasOwn(resource, 'subarea_code') || resource.subarea_code === null || isCode(resource.subarea_code));
}

function validCrmResource(resource) {
  return hasAreaResource(resource, 'comercial')
    && hasOwn(resource, 'owner_id')
    && isId(resource.owner_id);
}

function validSiioAssignmentResource(resource) {
  return hasAreaResource(resource)
    && hasOwn(resource, 'assignee_id')
    && isId(resource.assignee_id);
}

function canScopeResource(profile, resource, expectedArea = null) {
  return hasAreaResource(resource, expectedArea)
    && hasAreaScope(profile, resource.area_code, resource.subarea_code ?? null);
}

function ownsResource(profile, resource, ownerField) {
  return isHuman(profile)
    && isRecord(resource)
    && hasOwn(resource, ownerField)
    && isId(resource[ownerField])
    && resource[ownerField] === profile.id;
}

function isCommercialDirector(profile) {
  return hasHumanRole(profile, DIRECTOR_ROLE) && hasAssignedArea(profile, 'comercial');
}

function canDirectorCommercialResource(profile, resource) {
  return isCommercialDirector(profile) && canScopeResource(profile, resource, 'comercial');
}

function canHumanTenderAction(profile) {
  return hasHumanRole(profile, HUMAN_TENDER_ROLES) && hasPermission(profile, TENDER_PERMISSION);
}

function canTenderCustodyAction(profile) {
  return isHuman(profile)
    && hasPermission(profile, TENDER_PERMISSION)
    && hasPermission(profile, TENDER_CUSTODY_PERMISSION);
}

function canTenderCompanyProfileAction(profile) {
  return isHuman(profile)
    && hasPermission(profile, TENDER_PERMISSION)
    && (hasPermission(profile, TENDER_COMPANY_PERMISSION) || hasPermission(profile, TENDER_CUSTODY_PERMISSION));
}

function canSiioAssignedAction(profile, resource) {
  if (hasHumanRole(profile, PRIVILEGED_ROLES)) return true;
  if (hasHumanRole(profile, DIRECTOR_ROLE)) return canScopeResource(profile, resource);
  return hasHumanRole(profile, COMMERCIAL_OR_COLLABORATOR_ROLES)
    && ownsResource(profile, resource, 'assignee_id');
}

export function hasPermission(profile, permissionCode) {
  const permissions = ownArray(profile, 'permissions');
  if (!isHuman(profile) || permissions === null || typeof permissionCode !== 'string') return false;
  const normalizedCode = permissionCode.trim();
  if (normalizedCode.length === 0) return false;
  for (const permission of ownArrayValues(permissions)) {
    if (permission === normalizedCode) return true;
  }
  return false;
}

function hasEligibleModule(profile, permissionCode) {
  return isHuman(profile)
    && isModulePermissionEligible(profile.role, permissionCode)
    && hasPermission(profile, permissionCode);
}

/**
 * Admin and gerencia have organization-wide scope. Director, comercial and
 * colaborador are limited to explicit assignments; a subarea assignment never
 * authorizes an area-wide request.
 */
export function hasAreaScope(profile, areaCode, subareaCode = null) {
  return isScopedHuman(profile, areaCode, subareaCode);
}

/**
 * Authorization flags in resources (for example `technical_authorized`) MUST
 * be constructed server-side from trusted authorization context, never from a
 * request body or query string.
 */
export function can(profile, action, resource = {}) {
  if ((!isHuman(profile) && !isAgent(profile)) || !KNOWN_ACTIONS.has(action) || !isRecord(resource)) {
    return false;
  }

  if (isAgent(profile)) {
    if (action === ACTIONS.AI_ANALYSIS_RUN || action === ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND) {
      return hasOwn(resource, 'technical_authorized') && resource.technical_authorized === true;
    }
    return false;
  }

  switch (action) {
    case ACTIONS.USERS_MANAGE:
      return hasHumanRole(profile, ADMIN_ROLE);

    case ACTIONS.NAV_GERENCIAL_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || (hasHumanRole(profile, DIRECTOR_ROLE) && hasAnyArea(profile));
    case ACTIONS.NAV_COMERCIAL_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || isCommercialDirector(profile)
        || hasHumanRole(profile, COMMERCIAL_ROLES);
    case ACTIONS.NAV_LICITACIONES_VIEW:
      return canHumanTenderAction(profile);

    case ACTIONS.MODULE_SIIO_VIEW:
      return hasEligibleModule(profile, 'modulo_siio_gerencial');
    case ACTIONS.MODULE_VIGIA_VIEW:
      return hasEligibleModule(profile, 'modulo_vig_ia');
    case ACTIONS.MODULE_DASHBOARD_VIEW:
      return hasEligibleModule(profile, 'modulo_dashboard_comercial');
    case ACTIONS.MODULE_ALERTS_VIEW:
      return hasEligibleModule(profile, 'modulo_alertas_comerciales');
    case ACTIONS.MODULE_OPPORTUNITIES_VIEW:
      return hasEligibleModule(profile, 'modulo_oportunidades');
    case ACTIONS.MODULE_GOALS_VIEW:
      return hasEligibleModule(profile, 'modulo_metas');
    case ACTIONS.MODULE_USERS_VIEW:
      return hasEligibleModule(profile, 'modulo_usuarios');

    // Pipeline summary is a collection-level action: privileged/commercial
    // roles may request `{}`; directors still need a scoped area resource.
    case ACTIONS.CRM_PIPELINE_SUMMARY_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || (hasHumanRole(profile, DIRECTOR_ROLE) && canDirectorCommercialResource(profile, resource))
        || hasHumanRole(profile, COMMERCIAL_ROLES);
    case ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW:
    case ACTIONS.CRM_OPPORTUNITY_EDIT:
    case ACTIONS.CRM_OPPORTUNITY_CREATE:
      if (!validCrmResource(resource)) return false;
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || canDirectorCommercialResource(profile, resource)
        || (hasHumanRole(profile, COMMERCIAL_ROLES) && ownsResource(profile, resource, 'owner_id'));
    case ACTIONS.CRM_OPPORTUNITY_REASSIGN:
      return validCrmResource(resource)
        && (hasHumanRole(profile, PRIVILEGED_ROLES) || canDirectorCommercialResource(profile, resource));

    case ACTIONS.LICITACIONES_VIEW:
    case ACTIONS.LICITACIONES_WORKBENCH_USE:
    case ACTIONS.LICITACIONES_SYNC:
    case ACTIONS.LICITACIONES_DISCARD_PROPOSE:
    case ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND:
      return canHumanTenderAction(profile);
    case ACTIONS.LICITACIONES_DISCARD_APPROVE:
    case ACTIONS.LICITACIONES_GO_NO_GO_APPROVE:
      return canHumanTenderAction(profile) && hasHumanRole(profile, new Set(['admin', 'gerencia', 'director']));
    case ACTIONS.LICITACIONES_CONVERT:
    case ACTIONS.LICITACIONES_CONFIGURE:
    case ACTIONS.LICITACIONES_WORKBENCH_CUSTODY:
      return canTenderCustodyAction(profile);
    case ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE:
      return canTenderCompanyProfileAction(profile);

    case ACTIONS.SIIO_AREA_VIEW:
    case ACTIONS.SIIO_SUBJECT_CREATE:
    case ACTIONS.SIIO_SUBJECT_EDIT:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        ? hasAreaResource(resource)
        : hasHumanRole(profile, DIRECTOR_ROLE) && canScopeResource(profile, resource);
    case ACTIONS.SIIO_ASSIGNMENT_VIEW:
    case ACTIONS.SIIO_ASSIGNMENT_UPDATE:
    case ACTIONS.SIIO_CLOSE_REQUEST:
      return validSiioAssignmentResource(resource) && canSiioAssignedAction(profile, resource);
    case ACTIONS.SIIO_CLOSE_APPROVE:
      return validSiioAssignmentResource(resource) && hasHumanRole(profile, PRIVILEGED_ROLES);

    case ACTIONS.BOARD_PUBLICATION_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || (hasHumanRole(profile, BOARD_ROLE)
          && hasOwn(resource, 'publication_status')
          && resource.publication_status === 'published');
    case ACTIONS.BOARD_DRAFT_EDIT:
    case ACTIONS.BOARD_APPROVE:
    case ACTIONS.BOARD_PUBLISH:
      return hasHumanRole(profile, PRIVILEGED_ROLES);

    case ACTIONS.AI_COMMERCIAL_DRAFT_RUN:
      if (!validCrmResource(resource)
        || !hasEligibleModule(profile, 'modulo_vig_ia')
        || !hasEligibleModule(profile, 'modulo_oportunidades')
        || !hasPermission(profile, 'vigia_copilot_pilot')) return false;
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || canDirectorCommercialResource(profile, resource)
        || (hasHumanRole(profile, COMMERCIAL_ROLES) && ownsResource(profile, resource, 'owner_id'));

    case ACTIONS.AI_ANALYSIS_RUN:
      // Only profiles holding explicit tender custody (licitaciones +
      // licitaciones_custodia) may spend AGT-002 Preview quota, regardless of
      // role; AGT-002 never authorizes GO/NO GO, which stays a separate human
      // decision gated below.
      return canTenderCustodyAction(profile);
    default:
      return false;
  }
}

export function requireAction(profile, action, resource = {}) {
  if (can(profile, action, resource)) return true;
  const error = new Error('No tiene autorización para realizar esta operación.');
  error.status = 403;
  error.code = 'FORBIDDEN';
  throw error;
}
