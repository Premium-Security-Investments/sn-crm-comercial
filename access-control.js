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
});

const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));
const TENDER_PERMISSION = 'licitaciones';
const HUMAN_TENDER_ROLES = new Set(['admin', 'gerencia', 'director', 'comercial']);
const PRIVILEGED_ROLES = new Set(['admin', 'gerencia']);
const EXPLICIT_SCOPE_ROLES = new Set(['director', 'comercial', 'colaborador']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCode = (value) => typeof value === 'string' && value.trim() === value && value.length > 0;
const isId = (value) => typeof value === 'string' && value.length > 0;

function isActiveProfile(profile) {
  return isRecord(profile)
    && profile.active === true
    && isId(profile.id)
    && typeof profile.role === 'string'
    && HUMAN_ROLES.has(profile.role)
    && (profile.identity_type === undefined || profile.identity_type === 'human' || profile.identity_type === 'agent');
}

function isAgent(profile) {
  return isActiveProfile(profile) && profile.identity_type === 'agent';
}

function isHuman(profile) {
  return isActiveProfile(profile) && !isAgent(profile);
}

function hasHumanRole(profile, roles) {
  return isHuman(profile) && roles.has(profile.role);
}

function validAssignment(assignment) {
  return isRecord(assignment)
    && isCode(assignment.area_code)
    && (assignment.subarea_code === null || isCode(assignment.subarea_code));
}

function assignments(profile) {
  return isActiveProfile(profile) && Array.isArray(profile.areas)
    ? profile.areas.filter(validAssignment)
    : [];
}

function hasAnyArea(profile) {
  return assignments(profile).length > 0;
}

function hasAssignedArea(profile, areaCode) {
  return assignments(profile).some((assignment) => assignment.area_code === areaCode);
}

function isScopedHuman(profile, areaCode, subareaCode = null) {
  if (!isHuman(profile) || !isCode(areaCode) || (subareaCode !== null && !isCode(subareaCode))) {
    return false;
  }
  if (PRIVILEGED_ROLES.has(profile.role)) {
    return true;
  }
  if (!EXPLICIT_SCOPE_ROLES.has(profile.role)) {
    return false;
  }
  return assignments(profile).some((assignment) => {
    if (assignment.area_code !== areaCode) return false;
    if (assignment.subarea_code === null) return true;
    return subareaCode !== null && assignment.subarea_code === subareaCode;
  });
}

function isResource(resource) {
  return isRecord(resource);
}

function hasAreaResource(resource, expectedArea = null) {
  return isResource(resource)
    && isCode(resource.area_code)
    && (expectedArea === null || resource.area_code === expectedArea)
    && (resource.subarea_code === undefined || resource.subarea_code === null || isCode(resource.subarea_code));
}

function canScopeResource(profile, resource, expectedArea = null) {
  return hasAreaResource(resource, expectedArea)
    && hasAreaScope(profile, resource.area_code, resource.subarea_code ?? null);
}

function ownsResource(profile, resource, ownerField) {
  return isHuman(profile)
    && isResource(resource)
    && isId(resource[ownerField])
    && resource[ownerField] === profile.id;
}

function isCommercialDirector(profile) {
  return hasHumanRole(profile, new Set(['director'])) && hasAssignedArea(profile, 'comercial');
}

function canDirectorCommercialResource(profile, resource) {
  return isCommercialDirector(profile) && canScopeResource(profile, resource, 'comercial');
}

function canHumanTenderAction(profile) {
  return hasHumanRole(profile, HUMAN_TENDER_ROLES) && hasPermission(profile, TENDER_PERMISSION);
}

function canSiioAssignedAction(profile, resource) {
  if (hasHumanRole(profile, PRIVILEGED_ROLES)) return isResource(resource);
  if (hasHumanRole(profile, new Set(['director']))) return canScopeResource(profile, resource);
  return hasHumanRole(profile, new Set(['comercial', 'colaborador'])) && ownsResource(profile, resource, 'assignee_id');
}

export function hasPermission(profile, permissionCode) {
  if (!isActiveProfile(profile) || !Array.isArray(profile.permissions) || typeof permissionCode !== 'string') {
    return false;
  }
  const normalizedCode = permissionCode.trim();
  return normalizedCode.length > 0 && profile.permissions.some((permission) => permission === normalizedCode);
}

/**
 * Admin and gerencia have organization-wide scope. Director, comercial and
 * colaborador are limited to explicit assignments; a subarea assignment never
 * authorizes an area-wide request.
 */
export function hasAreaScope(profile, areaCode, subareaCode = null) {
  return isScopedHuman(profile, areaCode, subareaCode);
}

export function can(profile, action, resource = {}) {
  if (!isActiveProfile(profile) || !KNOWN_ACTIONS.has(action) || !isResource(resource)) {
    return false;
  }

  if (isAgent(profile)) {
    if (action === ACTIONS.AI_ANALYSIS_RUN || action === ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND) {
      return resource.technical_authorized === true;
    }
    return false;
  }

  switch (action) {
    case ACTIONS.USERS_MANAGE:
      return hasHumanRole(profile, new Set(['admin']));

    case ACTIONS.NAV_GERENCIAL_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || (hasHumanRole(profile, new Set(['director'])) && hasAnyArea(profile));
    case ACTIONS.NAV_COMERCIAL_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || isCommercialDirector(profile)
        || hasHumanRole(profile, new Set(['comercial']));
    case ACTIONS.NAV_LICITACIONES_VIEW:
      return canHumanTenderAction(profile);

    case ACTIONS.CRM_PIPELINE_SUMMARY_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || (hasHumanRole(profile, new Set(['director'])) && canDirectorCommercialResource(profile, resource))
        || hasHumanRole(profile, new Set(['comercial']));
    case ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW:
    case ACTIONS.CRM_OPPORTUNITY_EDIT:
    case ACTIONS.CRM_OPPORTUNITY_CREATE:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || canDirectorCommercialResource(profile, resource)
        || (hasHumanRole(profile, new Set(['comercial'])) && ownsResource(profile, resource, 'owner_id'));
    case ACTIONS.CRM_OPPORTUNITY_REASSIGN:
      return hasHumanRole(profile, PRIVILEGED_ROLES) || canDirectorCommercialResource(profile, resource);

    case ACTIONS.LICITACIONES_VIEW:
    case ACTIONS.LICITACIONES_SYNC:
    case ACTIONS.LICITACIONES_DISCARD_PROPOSE:
    case ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND:
      return canHumanTenderAction(profile);
    case ACTIONS.LICITACIONES_DISCARD_APPROVE:
    case ACTIONS.LICITACIONES_GO_NO_GO_APPROVE:
      return canHumanTenderAction(profile) && hasHumanRole(profile, new Set(['admin', 'gerencia', 'director']));

    case ACTIONS.SIIO_AREA_VIEW:
    case ACTIONS.SIIO_SUBJECT_CREATE:
    case ACTIONS.SIIO_SUBJECT_EDIT:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        ? hasAreaResource(resource)
        : hasHumanRole(profile, new Set(['director'])) && canScopeResource(profile, resource);
    case ACTIONS.SIIO_ASSIGNMENT_VIEW:
    case ACTIONS.SIIO_ASSIGNMENT_UPDATE:
    case ACTIONS.SIIO_CLOSE_REQUEST:
      return canSiioAssignedAction(profile, resource);
    case ACTIONS.SIIO_CLOSE_APPROVE:
      return hasHumanRole(profile, PRIVILEGED_ROLES);

    case ACTIONS.BOARD_PUBLICATION_VIEW:
      return hasHumanRole(profile, PRIVILEGED_ROLES)
        || (hasHumanRole(profile, new Set(['junta'])) && resource.publication_status === 'published');
    case ACTIONS.BOARD_DRAFT_EDIT:
    case ACTIONS.BOARD_APPROVE:
    case ACTIONS.BOARD_PUBLISH:
      return hasHumanRole(profile, PRIVILEGED_ROLES);

    case ACTIONS.AI_ANALYSIS_RUN:
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
