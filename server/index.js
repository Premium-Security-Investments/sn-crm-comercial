import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { extractTenderDocumentText, resolveLegacyExtractedText } from '../tender-document-text-extraction.js';
import { buildTenderDocumentExtractionRpcParams, mergeCanonicalExtractionIntoDocument, publicTenderDocumentProjection, selectCanonicalExtractionsByDocumentVersion } from '../tender-document-extraction-persistence.js';
import { callCreateTenderProcessingJob, callTenderOpportunityConversion, callTenderOpportunityDiscard, callTenderOpportunityExit, callTenderTrackingTransition, callTenderTrackingUpdate } from '../tender-tracking-rpc.js';
import { isTenderDurablePipelineEnabled, isTenderPublicUiEnabled, isTenderAutoAnalysisEnabled } from '../tender-durable-flags.js';
import { createTenderProcessingWorker } from '../tender-processing-worker.js';
import { createTenderProcessingDrain } from '../tender-processing-drain.js';
import { dispatchTenderProcessingAfterConversion } from '../tender-processing-dispatch.js';
import { appendTenderProcessingEvent, claimTenderProcessingJob, getTenderProcessingJobActor, recordTenderDocumentChunk, recordTenderImportItem, updateTenderProcessingJob } from '../tender-processing-worker-rpc.js';
import { buildAgt002DocumentChunks } from '../agt002-document-chunks.js';
import { runInConcurrentChunks } from '../tender-concurrency.js';
import { callTenderGoNoGoDecision, getTenderGoNoGoDecision, requireTenderGoForPreparation } from '../tender-go-no-go-rpc.js';
import { callTenderOfferStatusTransition, getTenderOfferStatus } from '../tender-offer-status-rpc.js';
import {
  getTenderDossierWorkspace,
  callCreateTenderDossierItem,
  callAppendTenderDossierItemAction,
  callCreateTenderDossierArtifact,
  callAddTenderDossierArtifactVersion,
  callRecordTenderDossierArtifactReview,
  callSeedTenderDossier,
} from '../tender-dossier-rpc.js';
import { buildTenderOfferPreparation } from '../tender-offer-preparation.js';
import { getCurrentTenderAnalysis, presentCurrentTenderAnalysis, registerSiioRulesAnalysis, registerTenderDocumentSnapshot } from '../tender-analysis-foundation.js';
import { registerAgt002ContextVersion } from '../tender-analysis-foundation.js';
import { isTenderAnalysisFoundationUnavailable, requireTenderAnalysisFoundation } from '../tender-analysis-foundation-availability.js';
import { buildTenderDeepAnalysis } from '../tender-deep-analysis.js';
import { can, requireAction } from '../access-control.js';
import { ACTIONS } from '../access-control.js';
import { MODULE_PERMISSION_CODES, isModulePermissionEligible } from '../module-access.js';
import { buildAgt003PrioritiesData } from '../agt003-priorities-service.js';
import { createAgt003CopilotApi } from '../agt003-copilot-api.js';
import { createAgt003CopilotRuntime, getAgt003CopilotRuntimeConfig, isAgt003CopilotConfigured } from '../agt003-copilot-runtime.js';
import { claimAgt003CopilotRun, computeAgt003CopilotHash, findAgt003CopilotRunById, findAgt003CopilotRunByKey, recordAgt003CopilotFeedback, recordAgt003CopilotFailure, recordAgt003CopilotRun, releaseAgt003CopilotClaim } from '../agt003-copilot-persistence.js';
import { loadVigiaApprovedAssets } from '../vigia-approved-assets.js';
import { listCompanyProcurementDocuments, recordCompanyProcurementDocument } from '../company-procurement-documents.js';
import { deterministicDocumentFallbackId, mergeTenderDocumentRecords, normalizeTenderSourceDocumentId, refreshOfficialTenderDocument, refreshTenderDocumentBatch, runOptionalTenderAnalysis, summarizeTenderDocumentRefresh } from '../tender-document-versioning.js';
import { canonicalizeTenderDocuments } from '../tender-document-canonicalizer.js';
import { isCriticalTenderDocument } from '../tender-critical-documents.js';
import { safeOfficialFetch, validateOfficialHttpsUrl } from '../safe-official-fetch.js';
import { createAgt002PreviewRuntime, getAgt002PreviewRuntimeConfig, isAgt002PreviewConfigured } from '../agt002-preview-runtime.js';
import { AGT002_INTEGRAL_V3_CONTRACT_VERSION, appendAgt002AnalysisAttempt, claimAgt002PreviewRun, computeAgt002PreviewIdempotencyKey, countAgt002PreviewRunsToday, findAgt002PreviewRun, getLatestAgt002AnalysisAttempt, registerAgt002PreviewAnalysis, releaseAgt002PreviewClaim } from '../agt002-preview-persistence.js';
import { getAgt002WorkbenchApi, postAgt002LearningReviewApi, postAgt002MessageApi, postAgt002RetryApi } from '../agt002-workbench-api.js';
import { isAgt002WorkbenchApiEnabled, isAgt002WorkbenchDrainEnabled, createAgt002WorkbenchDrain } from '../agt002-workbench-runtime.js';
import { isTenderTrackableStatus, normalizeTenderStatusText, officialTenderStatus } from '../tender-source-status.js';
import { assertPublicActuationType, PUBLIC_ACTUATION_TYPES } from '../tender-actuation-types.js';
import { buildAgt002AnalysisConfig } from '../agt002-analysis-config.js';
import { AGT002_CANONICAL_PREVIEW_STAGES, createAgt002AnalysisObservability, toBoundedAgt002Error } from '../agt002-analysis-observability.js';
import { AGT002_OPPORTUNITY_CONTEXT_SELECT, loadAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { loadAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { loadAgt002CompanyEvidenceRegistryEntries } from '../agt002-company-evidence-classes.js';
import { loadAgt002IntegralGovernanceOverrides } from '../agt002-integral-governance-overrides.js';
import {
  runAgt002FixedSnapshotReanalysis,
  sanitizeAgt002FixedSnapshotError,
} from '../agt002-fixed-snapshot-reanalysis.js';
import { adaptAgt002RetrievalDocuments } from '../agt002-retrieval-document-adapter.js';
import { loadPublishedAgt002LegalCorpus } from '../agt002-legal-corpus-store.js';

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
const agt002AnalysisConfig = buildAgt002AnalysisConfig(process.env);
const agt002AnalysisObservability = createAgt002AnalysisObservability();

async function loadAgt002LegalCorpusContextIfEnabled(database) {
  return agt002AnalysisConfig.AGT002_LEGAL_CORPUS
    ? loadPublishedAgt002LegalCorpus(database)
    : null;
}

// AGT002_INTEGRAL_CONTRACT_V3: real, read-only DB source for the two governed maps
// createAgt002PreviewRuntime requires as explicit constructor configuration
// (companyEvidenceClassesProvider's raw rows, categoryOverrides,
// evidenceClassLinkByRequirementId) instead of the fail-closed empty defaults it used
// before this wiring existed. Mirrors loadAgt002LegalCorpusContextIfEnabled above: no DB
// round-trip at all when the flag is off, and every field the runtime needs when it is on
// — never a partial map, since buildAgt002IntegralGovernanceOverrides itself fails closed
// on any malformed curated row.
async function loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId) {
  if (!agt002AnalysisConfig.AGT002_INTEGRAL_CONTRACT_V3) return null;
  const [companyEvidenceRegistryEntries, governanceOverrides] = await Promise.all([
    loadAgt002CompanyEvidenceRegistryEntries(database),
    loadAgt002IntegralGovernanceOverrides(database, opportunityId),
  ]);
  return {
    companyEvidenceRegistryEntries,
    categoryOverrides: governanceOverrides.categoryOverrides,
    evidenceClassLinkByRequirementId: governanceOverrides.evidenceClassLinkByRequirementId,
    governanceProvenance: governanceOverrides.provenance,
  };
}

function sendError(res, error, status = 500) {
  if (isTenderAnalysisFoundationUnavailable(error)) {
    console.warn('tender_analysis_foundation_unavailable', { event: 'tender_analysis_foundation_unavailable' });
    return res.status(503).json({ error: 'La fundación de análisis documental no está disponible.', code: 'TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE' });
  }
  console.error(error);
  return res.status(status).json({ error: error?.message || String(error) });
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
  'POST /api/vigia/copilot/generate': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN],
  'POST /api/vigia/copilot/feedback': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN],

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
const SIIO_PUBLISHED_BOARD_RESOURCE = Object.freeze({ status: 'presentado' });
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
export function requirePrioritiesAction(profile) {
  if (can(profile, ACTIONS.MODULE_ALERTS_VIEW) || can(profile, ACTIONS.MODULE_VIGIA_VIEW)) return true;
  return requireAction(profile, ACTIONS.MODULE_VIGIA_VIEW, {});
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
export function clientProfileForTenderUi(profile, environment = process.env) {
  if (!profile || isTenderPublicUiEnabled(environment)) return profile;
  if (!Array.isArray(profile.permissions) || !profile.permissions.includes('licitaciones')) return profile;
  return {
    ...profile,
    permissions: profile.permissions.filter(permission => permission !== 'licitaciones'),
  };
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
const BOOTSTRAP_PROFILE_SELECT = 'id,full_name,role,active';
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
export function filterBootstrapForProfile(payload, currentProfile, environment = process.env) {
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
    : []).map(({ id, full_name, role, active }) => ({
      id,
      full_name,
      is_commercial: role === 'comercial' && active !== false,
    }));
  const totals = opportunities.reduce((acc, o) => {
    acc.count += 1;
    acc.pipeline += Number(o.offer_value || 0);
    acc.weighted += Number(o.weighted_pipeline_value || 0);
    if (o.stage_code === 'aprobado') acc.approved += Number(o.offer_value || 0);
    return acc;
  }, { count: 0, pipeline: 0, weighted: 0, approved: 0 });
  return { ...publicPayload, summary, opportunities, profiles, stages, services, lossReasons, stalled, topClosing, monthlyKpis, goals, totals: capabilities.dashboard || capabilities.vigia ? totals : { count: 0, pipeline: 0, weighted: 0, approved: 0 }, currentProfile: clientProfileForTenderUi(currentProfile, environment) };
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
const DATOS_GOV_FETCH_POLICY = { allowedHosts: ['www.datos.gov.co'], allowedPath: /^\/resource\/[a-z0-9-]+\.json$/i };
const SECOP_DOCUMENT_FETCH_POLICY = { allowedHosts: ['community.secop.gov.co', 'secop.gov.co', '*.secop.gov.co', 'colombiacompra.gov.co', '*.colombiacompra.gov.co', 'www.datos.gov.co'] };
const ESU_FETCH_POLICY = { allowedHosts: ['esucontratacion.com', 'www.esucontratacion.com'], allowedPath: /^\/procesos(?:\/|$)/i };
const TENDER_DISCOVERY_RECORD_CONCURRENCY = 5;
const TENDER_CHUNK_RECORD_CONCURRENCY = 5;
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
// Terms specific enough, on their own, to prove a process is about a PSI-offerable service.
// Bare "vigilancia" and "guardas" only rank a candidate; they require explicit physical-security context.
const tenderContextualPhysicalSecurityReason = 'vigilancia física contextual';
const tenderPhysicalSecurityContextTerms = [
  'vigilancia fisica', 'puesto de vigilancia', 'puestos de vigilancia', 'proteccion de instalaciones',
  'proteccion de bienes', 'proteccion de personas', 'bienes y personas', 'custodia', 'seguridad perimetral',
  'servicio canino', 'vigilancia canina', 'con armas', 'sin armas', 'sedes institucionales'
].map(normTenderText);
const tenderCoreServiceTerms = new Set([
  'vigilancia y seguridad privada', 'vigilancia y seguridad', 'servicios de vigilancia', 'servicio de vigilancia',
  'vigilancia armada', 'vigilancia privada', 'seguridad privada', 'seguridad electronica', 'seguridad electrónica',
  'cctv', 'videovigilancia', 'video vigilancia', 'control de acceso', 'circuito cerrado',
  tenderContextualPhysicalSecurityReason
]);
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
const tenderNonSecurityContextTerms = [
  // "Vigilancia" en salud/agro no es vigilancia y seguridad privada.
  'vigilancia epidemiologica', 'vigilancia sanitaria', 'vigilancia en salud publica',
  'vigilancia fitosanitaria', 'vigilancia veterinaria', 'monitoreo epidemiologico',
  'sanidad aviar', 'influenza aviar', 'tifosis aviar', 'enfermedad de newcastle',
  'diagnostico veterinario', 'cadena avicola'
];
const tenderFocusTerms = { 'bogotá': 22, 'bogota': 22, 'distrito capital': 20, 'medellín': 22, 'medellin': 22, 'antioquia': 14 };
const tenderInternalStatuses = ['nueva','en_revision','descartada','convertida_oportunidad'];
export function canViewTenders(profile) { return can(profile, ACTIONS.LICITACIONES_VIEW); }
const tenderRegionKeys = ['todas','bog_cundinamarca','med_antioquia','eje_cafetero','cali_valle','costa_caribe','santanderes','sur_occidente','otros'];
const tenderSectionFilters = ['todas','hacer','revisar','prioridad_baja'];
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
  await must(database.rpc('psi_upsert_company_procurement_profile', {
    p_actor_id: payload.updated_by,
    p_payload: payload,
  }));
}
async function saveTenderCompanyProfileDirect(database, payload) {
  await must(database
    .from('psi_company_procurement_profile')
    .upsert(payload, { onConflict: 'singleton_key' }));
}
function cleanCompanyDocumentMetadata(body) {
  const documentType = String(body?.documentType || body?.document_type || '').trim().toLowerCase();
  const displayName = String(body?.displayName || body?.display_name || '').trim();
  const issuedAt = String(body?.issuedAt || body?.issued_at || '').trim();
  const expiresAt = body?.expiresAt ?? body?.expires_at ?? null;
  const replaceDocumentId = body?.replaceDocumentId ?? body?.replace_document_id ?? null;
  const normalizedExpiresAt = expiresAt === null || expiresAt === '' ? null : String(expiresAt).trim();
  if (!documentType || !displayName || !isCalendarDate(issuedAt)) throw clientInputError('Tipo, nombre visible y fecha de expedición son obligatorios.');
  if (normalizedExpiresAt && !isCalendarDate(normalizedExpiresAt)) throw clientInputError('La fecha de vencimiento no es válida.');
  if (normalizedExpiresAt && normalizedExpiresAt < issuedAt) throw clientInputError('La fecha de vencimiento no puede ser anterior a la expedición.');
  return { documentType, displayName, issuedAt, expiresAt: normalizedExpiresAt, replaceDocumentId: replaceDocumentId || null };
}
function clientInputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function companyDocumentStoragePath(profile, name, size) {
  const id = createHash('sha256').update(`company-profile:${profile.id}:${Date.now()}:${name}:${size}`).digest('hex').slice(0, 24);
  return `company-profile/documents/${profile.id}/${id}-${name}`;
}
async function presentCompanyProcurementDocuments(database) {
  const documents = await listCompanyProcurementDocuments(database);
  return Promise.all(documents.map(async document => {
    const { data, error } = await database.storage.from(tenderDocumentBucket).createSignedUrl(document.storage_path, 15 * 60);
    if (error) throw error;
    return { ...document, url: data?.signedUrl || null };
  }));
}
function normTenderText(value) { return normalizeTenderStatusText(value); }
export function isTenderTrackable(item) {
  const text = tenderText(item?.raw || item || {});
  const hasNonSecurityContext = tenderNonSecurityContextTerms.some(term => text.includes(normTenderText(term)));
  return !hasNonSecurityContext && isTenderTrackableStatus(item) && !tenderDisqualifyingTerms.some(term => text.includes(normTenderText(term)));
}
function tenderMoney(value) { const n = Number(String(value || '0').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function tenderDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function tenderDaysUntil(value) { const d = tenderDate(value); if (!d) return null; const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.round((d.getTime() - today.getTime()) / 86400000); }
function tenderWindow(days) { if (days === null) return 'sin fecha de cierre reportada'; if (days <= 7) return 'urgente (0-7 días)'; if (days <= 15) return 'revisar rápido (8-15 días)'; if (days <= 30) return 'buena ventana (16-30 días)'; return 'ventana amplia'; }
function tenderText(row) { return normTenderText(Object.values(row || {}).filter(v => typeof v === 'string').join(' ')); }
// Scoped to the objeto/título/descripción-like fields declared per source (tenderSources[*].nameFields)
// instead of every string in the raw row, so an entity/department name or an unrelated field can never
// by itself produce a positive-term match. Falls back to the whole row only when no fields are declared.
function tenderObjectText(row, nameFields) {
  if (!Array.isArray(nameFields) || !nameFields.length) return tenderText(row);
  return normTenderText(nameFields.map(field => (typeof row?.[field] === 'string' ? row[field] : '')).join(' '));
}
function stableTenderKey(tender) {
  const base = [tender.source, tender.process_id || tender.ref, tender.entity, tender.title].map(v => normTenderText(v)).join('|');
  return createHash('sha1').update(base).digest('hex').slice(0, 20);
}
const tenderPositiveEntries = Object.entries(tenderPositiveTerms).map(([term, pts]) => [term, pts, normTenderText(term), tenderCoreServiceTerms.has(term)]).sort((a, b) => b[2].length - a[2].length);
// Eligibility (and its read-path re-validation over persisted `reasons`) is decided purely from
// whether a core PSI-service term matched — never from a generic word, a value/foco-zone bonus, or a
// re-scan of the whole raw row. Fails closed (ineligible) when reasons are missing.
function hasTenderPhysicalSecurityContext(text) {
  return text.includes(normTenderText('vigilancia')) && tenderPhysicalSecurityContextTerms.some(term => text.includes(term));
}
export function hasTenderServiceSignal(item) {
  const reasons = item?.reasons || [];
  if (reasons.some(reason => tenderCoreServiceTerms.has(reason))) return true;
  if (!reasons.includes('vigilancia')) return false;
  const text = item?.raw ? tenderText(item.raw) : tenderText(item);
  return hasTenderPhysicalSecurityContext(text);
}
export function scoreTender(row, nameFields) {
  const objectText = tenderObjectText(row, nameFields);
  const text = tenderText(row); let score = 0; const reasons = []; const risks = [];
  const matchedPositiveTerms = [];
  for (const [term, pts, normalizedTerm] of tenderPositiveEntries) {
    if (objectText.includes(normalizedTerm) && !matchedPositiveTerms.some(matched => matched.includes(normalizedTerm) || normalizedTerm.includes(matched))) {
      matchedPositiveTerms.push(normalizedTerm);
      score += pts;
      reasons.push(term);
    }
  }
  if (reasons.includes('vigilancia') && hasTenderPhysicalSecurityContext(objectText)) {
    reasons.push(tenderContextualPhysicalSecurityReason);
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
  if (tender.risks.some(r => r.includes('no ofertable'))) return 'prioridad_baja';
  if (tender.score < 70 || (tender.value > 0 && tender.value < 50000000)) return 'prioridad_baja';
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
    value, status: officialTenderStatus(row, source), category: isSecop2 ? row.codigo_principal_de_categoria || '' : '',
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
  const scored = scoreTender(row, tenderSources[originalSource]?.nameFields);
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
  return rows.filter(row => !isEsuEntityRow(row, source)).map(row => ({ row, scored: scoreTender(row, cfg.nameFields) })).filter(x => hasTenderServiceSignal(x.scored)).map(x => normalizeTender(x.row, source, x.scored));
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
  const scored = scoreTender(row, tenderSources['SECOP I'].nameFields);
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
  const response = await safeOfficialFetch(url, ESU_FETCH_POLICY, { ...options, maxBytes: 10 * 1024 * 1024, headers: { 'User-Agent': 'SN-CRM-ESU-Tenders-Radar/1.0', ...(options.headers || {}) } });
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
  const preliminary = Array.from(seen.values()).map(row => normalizeEsuProcess(row)).filter(t => t.days === null || t.days >= 0).filter(isTenderTrackable).sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
  const enriched = [];
  for (const [index, tender] of preliminary.entries()) {
    if (index >= 40) { enriched.push(tender); continue; }
    const sourceRow = seen.get(parseEsuProcessId(tender.url));
    const detail = await fetchEsuProcessDetail(sourceRow);
    enriched.push(normalizeEsuProcess(sourceRow, detail));
  }
  return enriched.filter(t => t.days === null || t.days >= 0).filter(isTenderTrackable).sort((a,b) => b.score - a.score || (a.days ?? 999) - (b.days ?? 999));
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
        if ((tender.days !== null && tender.days < 0) || !isTenderTrackable(tender)) continue;
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
      const visibleCount = result.value.filter(t => (t.days === null || t.days >= 0) && isTenderTrackable(t)).length;
      diagnostics.push({ source, status: 'ok', count: visibleCount, message: visibleCount ? `${visibleCount} candidato(s)` : 'Sin candidatos relevantes hoy' });
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
  const persistenceTenders = batches.flat().filter(t => {
    const key = t.stable_key || stableTenderKey(t);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const tenders = persistenceTenders.filter(t => (t.days === null || t.days >= 0) && isTenderTrackable(t)).sort((a,b) => {
    const sectionOrder = { hacer: 0, revisar: 1, prioridad_baja: 2 };
    return sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || (a.days ?? 999) - (b.days ?? 999);
  });
  return { tenders, persistenceTenders, diagnostics };
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
      prioridadBaja: normalized.filter(t => t.section === 'prioridad_baja').length,
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
  return row?.internal_status === 'convertida_oportunidad';
}
async function readAllConvertedTenderRows(database) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const result = await database.from('psi_public_tenders').select('*')
      .eq('internal_status', 'convertida_oportunidad')
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
    const sectionOrder = { hacer: 0, revisar: 1, prioridad_baja: 2 };
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
const TENDER_PERSISTENCE_SECTIONS = new Set(['hacer', 'revisar', 'prioridad_baja']);
export function normalizeTenderPersistenceSection(section) {
  return TENDER_PERSISTENCE_SECTIONS.has(section) ? section : 'prioridad_baja';
}
async function persistTenderRadar(database, actorProfile, mode = 'manual') {
  const fetchedPayload = await fetchPublicTenderRadar();
  const fetched = fetchedPayload.tenders;
  const persistenceTenders = fetchedPayload.persistenceTenders || fetched;
  const diagnostics = fetchedPayload.diagnostics;
  if (!(await tenderTableAvailable(database))) {
    const live = await enrichLiveTendersWithConversions(database, fetched);
    return radarPayload(live, new Date().toISOString(), 'live_no_table', diagnostics);
  }
  const now = new Date().toISOString();
  const rows = persistenceTenders.map(t => ({
    stable_key: stableTenderKey(t), source: t.source, section: normalizeTenderPersistenceSection(t.section), entity: t.entity, dept: t.dept || null, city: t.city || null,
    ref: t.ref || null, process_id: t.process_id || null, title: t.title, description: t.desc || null, value: Number(t.value || 0),
    status: t.status || null, category: t.category || null, published_at: t.published || null, deadline_at: t.deadline || null,
    score: Number(t.score || 0), reasons: t.reasons || [], risks: t.risks || [], url: t.url || null, raw: t.raw || null, last_seen_at: now
  }));
  if (rows.length) {
    const { error: upsertError } = await database.from('psi_public_tenders').upsert(rows, { onConflict: 'stable_key', defaultToNull: false });
    if (upsertError) throw upsertError;
  }
  await database.from('psi_tender_radar_runs').insert({ run_at: now, triggered_by: actorProfile?.id || null, mode, count_total: fetched.length, count_hacer: fetched.filter(r => r.section === 'hacer').length, count_revisar: fetched.filter(r => r.section === 'revisar').length, count_prioridad_baja: fetched.filter(r => r.section === 'prioridad_baja').length, summary: `Radar multifuente sincronizado: ${fetched.length} procesos/eventos visibles; ${rows.length} actualizados. ${diagnostics.map(d => `${d.source}: ${d.status}`).join(' · ')}` });
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
    .select('*')
    .eq('stable_key', stableKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw trackingError('La licitación persistida no existe; no se puede omitir la trazabilidad de seguimiento.', 409);
  return data;
}
function escapeSocrataLiteral(value) { return String(value || '').replaceAll("'", "''"); }
async function revalidateTenderOfficialStatus(tender) {
  if (!['SECOP I', 'SECOP II'].includes(tender?.source)) return tender;
  const isSecop2 = tender.source === 'SECOP II';
  const cfg = tenderSources[tender.source];
  const identityField = isSecop2 ? 'id_del_proceso' : 'numero_de_proceso';
  const identityValue = isSecop2 ? tender.process_id : tender.ref;
  if (!cfg || !identityValue) throw trackingError('No se pudo verificar el estado oficial vigente. Actualice el radar antes de convertir.', 409);
  const params = new URLSearchParams({
    '$select': cfg.select,
    '$where': `${identityField}='${escapeSocrataLiteral(identityValue)}'`,
    '$limit': '2',
  });
  let response;
  try {
    response = await fetch(`${cfg.base}?${params.toString()}`, { headers: { 'User-Agent': 'SN-CRM-Tender-Conversion-Guard/1.0' } });
  } catch {
    throw trackingError('SECOP no está disponible para verificar el estado vigente. Actualice el radar e intente nuevamente.', 409);
  }
  if (!response.ok) throw trackingError('SECOP no pudo verificar el estado vigente. Actualice el radar e intente nuevamente.', 409);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw trackingError('No se pudo confirmar un único proceso vigente en SECOP. Actualice el radar antes de convertir.', 409);
  return { ...tender, status: officialTenderStatus(rows[0], tender.source), raw: rows[0] };
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

async function getTenderTrackingTender(database, tenderReferenceId) {
  const { data, error } = await database.from('psi_public_tenders').select('*').or(`id.eq.${tenderReferenceId},converted_opportunity_id.eq.${tenderReferenceId}`).maybeSingle();
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

const TENDER_TRACKING_EVENTS_DEFAULT_LIMIT = 50;
const TENDER_TRACKING_EVENTS_MAX_LIMIT = 200;
const TENDER_BUSINESS_EVENT_TYPES = [
  'entered_tracking', 'tracking_updated', 'assigned', 'blocked', 'unblocked', 'returned_to_radar', 'converted', 'discarded',
  'requirement_pending', 'information_requested', 'addendum_reviewed', 'observation_recorded', 'internal_meeting', 'case_note',
  'go_decided', 'no_go_decided', 'offer_preparation_started', 'offer_submitted', 'awarded', 'not_awarded', 'cancelled', 'deserted',
  'dossier_seeded', 'dossier_artifact_approved', 'offer_ready_for_submission',
];
const TENDER_TECHNICAL_EVENT_TYPES = [
  'detected', 'pipeline_queued', 'document_discovery_started', 'document_import_progress', 'document_import_completed',
  'document_import_partial', 'document_import_failed', 'snapshot_published', 'analysis_queued', 'analysis_started',
  'analysis_completed', 'analysis_failed', 'analysis_rules_fallback_shown',
];

function parseTenderTrackingEventsCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const separatorIndex = raw.lastIndexOf(',');
  const createdAt = separatorIndex > 0 ? raw.slice(0, separatorIndex) : '';
  const id = separatorIndex > 0 ? raw.slice(separatorIndex + 1) : '';
  if (!createdAt || Number.isNaN(Date.parse(createdAt)) || !tenderTrackingIdPattern.test(id)) throw trackingError('Cursor de historial inválido.');
  return { createdAt, id };
}

app.get('/api/tender-tracking-events', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const database = requireDb();
    const tenderId = requireTenderTrackingId(req.query.id);
    const tender = await getTenderTrackingTender(database, tenderId);
    const limit = Math.min(TENDER_TRACKING_EVENTS_MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || TENDER_TRACKING_EVENTS_DEFAULT_LIMIT));
    const cursor = parseTenderTrackingEventsCursor(req.query.cursor);
    const scope = String(req.query.scope || 'business');
    if (!['business', 'technical'].includes(scope)) throw trackingError('Alcance de historial inválido.');
    const eventTypes = scope === 'technical' ? TENDER_TECHNICAL_EVENT_TYPES : TENDER_BUSINESS_EVENT_TYPES;
    let query = database.from('psi_tender_tracking_events').select('*').eq('tender_id', tender.id)
      .in('event_type', eventTypes)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const rows = (await must(query)) || [];
    const events = rows.slice(0, limit);
    const next_cursor = rows.length > limit ? `${events[events.length - 1].created_at},${events[events.length - 1].id}` : null;
    res.json({ events, next_cursor });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-actuation', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const database = requireDb();
    const tenderId = requireTenderTrackingId(req.body?.tender_id);
    const tender = await getTenderTrackingTender(database, tenderId);
    const actuationType = String(req.body?.type || '').trim();
    assertPublicActuationType(actuationType);
    const note = String(req.body?.note || '').trim();
    if (!note) throw trackingError('La descripción de la actuación es obligatoria.');
    const { data, error } = await database.rpc('psi_append_tender_tracking_event', {
      p_tender_id: tender.id,
      p_event_type: actuationType,
      p_actor_kind: 'human',
      p_created_by: currentProfile.id,
      p_source_ref_type: null,
      p_source_ref_id: null,
      p_metadata: null,
      p_note: note,
      p_singular: false,
    });
    if (error) throw error;
    res.json(data);
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
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
    res.status(201).json(await saveTenderSearchProfile(requireDb(), req.body, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.delete('/api/tender-search-profiles/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
    res.json(await deleteTenderSearchProfile(requireDb(), req.params.id));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-company-profile', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
    res.json(await getTenderCompanyProfile(requireDb()));
  } catch (error) { sendAuthError(res, error); }
});

app.get('/api/tender-company-documents', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
    res.json(await presentCompanyProcurementDocuments(requireDb()));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-document-upload-url', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
    const metadata = cleanCompanyDocumentMetadata(req.body);
    const name = cleanFileName(req.body?.name || metadata.displayName);
    const size = Number(req.body?.size);
    if (!Number.isFinite(size) || size <= 0) throw clientInputError('Debe seleccionar un documento empresarial válido.');
    if (size > RUP_MAX_BYTES) throw clientInputError('El documento empresarial supera 50MB.');
    const database = requireDb();
    await ensureTenderBucket(database);
    const path = companyDocumentStoragePath(currentProfile, name, size);
    const { data, error } = await database.storage.from(tenderDocumentBucket).createSignedUploadUrl(path);
    if (error) throw error;
    res.json({ path, token: data.token });
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-document-process-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
    const metadata = cleanCompanyDocumentMetadata(req.body);
    const storagePath = String(req.body?.storage_path || '');
    if (!storagePath.startsWith(`company-profile/documents/${currentProfile.id}/`) || storagePath.includes('..')) throw clientInputError('Ruta de documento empresarial inválida.');
    const name = cleanFileName(req.body?.name || storagePath.split('/').at(-1) || metadata.displayName);
    const database = requireDb();
    const { data, error } = await database.storage.from(tenderDocumentBucket).download(storagePath);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.length) throw clientInputError('El documento empresarial cargado está vacío.');
    if (buffer.length > RUP_MAX_BYTES) throw clientInputError('El documento empresarial supera 50MB.');
    await recordCompanyProcurementDocument(database, { ...metadata, content: buffer, storagePath, mimeType: req.body?.mime_type || 'application/octet-stream', sizeBytes: buffer.length, uploadedBy: currentProfile.id });
    if (metadata.documentType === 'rup') {
      const extractedText = await extractTextFromTenderFile(buffer, name, req.body?.mime_type || '');
      const existing = await getTenderCompanyProfile(database);
      await saveTenderCompanyProfile(database, cleanTenderCompanyProfile(parseRupCompanyProfile(extractedText, existing, name), currentProfile));
    }
    res.status(201).json({ profile: await getTenderCompanyProfile(database), documents: await presentCompanyProcurementDocuments(database) });
  } catch (error) { sendAuthError(res, error); }
});

app.put('/api/tender-company-profile', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE);
    const database = requireDb();
    const payload = cleanTenderCompanyProfile(req.body, currentProfile);
    if (can(currentProfile, ACTIONS.LICITACIONES_CONFIGURE)) await saveTenderCompanyProfile(database, payload);
    else await saveTenderCompanyProfileDirect(database, payload);
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-upload-url', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
    const database = requireDb();
    const name = cleanFileName(req.body?.name || 'rup-actualizado.pdf');
    const size = Number(req.body?.size);
    if (!Number.isFinite(size) || size <= 0) throw clientInputError('Debe seleccionar un archivo RUP válido.');
    if (size > RUP_MAX_BYTES) throw clientInputError('El RUP supera 50MB. Reduzca el archivo o cargue una versión PDF/DOCX más liviana.');
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
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
    const database = requireDb();
    const storagePath = String(req.body?.storage_path || '');
    if (!storagePath.startsWith('company-profile/rup/')) throw clientInputError('Ruta de RUP inválida.');
    const name = cleanFileName(req.body?.name || storagePath.split('/').at(-1) || 'rup-actualizado.pdf');
    const { data, error } = await database.storage.from(tenderDocumentBucket).download(storagePath);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.length) throw clientInputError('El RUP cargado está vacío.');
    if (buffer.length > RUP_MAX_BYTES) throw clientInputError('El RUP supera 50MB. Reduzca el archivo o cargue una versión PDF/DOCX más liviana.');
    const extractedText = await extractTextFromTenderFile(buffer, name, req.body?.mime_type || '');
    const existing = await getTenderCompanyProfile(database);
    const payload = cleanTenderCompanyProfile(parseRupCompanyProfile(extractedText, existing, name), currentProfile);
    await recordCompanyProcurementDocument(database, { documentType: 'rup', displayName: name, issuedAt: payload.rup_updated_at || new Date().toISOString().slice(0, 10), expiresAt: null, content: buffer, storagePath, mimeType: req.body?.mime_type || 'application/octet-stream', sizeBytes: buffer.length, uploadedBy: currentProfile.id });
    await saveTenderCompanyProfile(database, payload);
    res.json(await getTenderCompanyProfile(database));
  } catch (error) { sendAuthError(res, error); }
});

app.post('/api/tender-company-profile-upload', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONFIGURE);
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
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONVERT);
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
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONVERT);
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
function siioFoundationUnavailable(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('does not exist')
    || message.includes('schema cache');
}
async function requiredSiioList(database, table, select = '*', order = 'created_at') {
  const query = database.from(table).select(select).limit(1000);
  if (order) query.order(order, { ascending: table === 'siio_board_sections' });
  const { data, error } = await query;
  if (error) {
    if (siioFoundationUnavailable(error)) {
      const unavailable = new Error('La fundación de datos SIIO no está disponible.');
      unavailable.status = 503;
      unavailable.code = 'SIIO_FOUNDATION_UNAVAILABLE';
      throw unavailable;
    }
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
    status: row?.status,
  }));
}

const SIIO_MANAGEMENT_PAYROLL_VISIBILITY = new Set(['gerencia', 'junta_agregado']);

function filterPayrollAggregatesForManagement(rows) {
  return rows.filter(row => SIIO_MANAGEMENT_PAYROLL_VISIBILITY.has(row?.visibility_level));
}

app.get('/api/siio/bootstrap', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    requireSiioEndpointAccess(profile, 'GET /api/siio/bootstrap');
    const database = requireDb();
    if (profile.role === 'junta') {
      const boardReports = filterBoardReportsForProfile(profile, await requiredSiioList(database, siioTables.boardReports, '*', 'period_month'));
      return res.json({ fronts: [], records: [], sources: [], decisions: [], boardReports, boardSections: [], financialMetrics: [], commercialSignals: [], payrollAggregates: [], strategicOpportunities: [], currentProfile: profile });
    }
    const [fronts, records, sources, decisions, boardReports, boardSections, financialMetrics, commercialSignals, payrollAggregates, strategicOpportunities] = await Promise.all([
      requiredSiioList(database, siioTables.fronts, '*', 'id'),
      requiredSiioList(database, siioTables.records, '*', 'updated_at'),
      requiredSiioList(database, siioTables.sources, '*', 'id'),
      requiredSiioList(database, siioTables.decisions, '*', 'created_at'),
      requiredSiioList(database, siioTables.boardReports, '*', 'period_month'),
      requiredSiioList(database, siioTables.boardSections, '*', 'section_order'),
      requiredSiioList(database, siioTables.financialMetrics, '*', 'period_month'),
      requiredSiioList(database, siioTables.commercialSignals, '*', 'period_month'),
      requiredSiioList(database, siioTables.payrollAggregates, 'id,period_month,area,total_people,total_accrued,total_deductions,net_total,variation_abs,alert,source_id,visibility_level', 'period_month'),
      requiredSiioList(database, siioTables.strategicOpportunities, '*', 'id')
    ]);
    const visiblePayrollAggregates = filterPayrollAggregatesForManagement(payrollAggregates);
    res.json({ fronts, records, sources, decisions, boardReports, boardSections, financialMetrics, commercialSignals, payrollAggregates: visiblePayrollAggregates, strategicOpportunities, currentProfile: profile });
  } catch (error) { sendAuthError(res, error); }
});
app.get('/api/siio/fronts', async (req, res) => {
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/fronts'); res.json(await requiredSiioList(requireDb(), siioTables.fronts, '*', 'id')); }
  catch (error) { sendAuthError(res, error); }
});
app.get('/api/siio/records', async (req, res) => {
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/records'); res.json(await requiredSiioList(requireDb(), siioTables.records, '*', 'updated_at')); }
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
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/sources'); res.json(await requiredSiioList(requireDb(), siioTables.sources, '*', 'id')); }
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
  try { const { profile } = await getAuthContext(req); requireSiioEndpointAccess(profile, 'GET /api/siio/decisions'); res.json(await requiredSiioList(requireDb(), siioTables.decisions, '*', 'created_at')); }
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
    res.json(filterBoardReportsForProfile(profile, await requiredSiioList(requireDb(), siioTables.boardReports, '*', 'period_month')));
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

async function fetchVigiaCustomerSegments(database, ownerIds) {
  const batches = ownerIds === null
    ? [null]
    : Array.from({ length: Math.ceil(ownerIds.length / VIGIA_OWNER_BATCH_SIZE) }, (_, index) => ownerIds.slice(index * VIGIA_OWNER_BATCH_SIZE, (index + 1) * VIGIA_OWNER_BATCH_SIZE));
  const rows = [];
  for (const ownerBatch of batches) {
    for (let offset = 0; ; offset += VIGIA_PAGE_SIZE) {
      let query = database.from('psi_sales_opportunities').select('id,customer_segment').order('id', { ascending: true });
      if (ownerBatch) query = query.in('owner_id', ownerBatch);
      const page = await must(query.range(offset, offset + VIGIA_PAGE_SIZE - 1));
      rows.push(...page);
      if (page.length < VIGIA_PAGE_SIZE) break;
    }
  }
  return rows;
}

function attachVigiaCustomerSegments(rows, segmentRows) {
  const segmentById = new Map(segmentRows.map(row => [row.id, row.customer_segment || null]));
  return rows.map(row => ({ ...row, customer_segment: segmentById.get(row.id) ?? null }));
}

const VIGIA_COPILOT_OPPORTUNITY_SELECT = 'id,owner_id,owner_name,company_name,stage_name,service_type_name,offer_value,expected_close_date,next_action_at,updated_at';
const VIGIA_APPROVED_ASSETS_PATH = path.join(__dirname, '..', 'config', 'vigia-approved-assets.v1.json');

async function resolveAgt003OpportunityResource(database, opportunityId, profile) {
  const opportunity = await must(database.from('psi_sales_opportunities').select('id,owner_id').eq('id', opportunityId).single());
  const assignments = await must(database.from('psi_profile_area_assignments').select('area_code,subarea_code').eq('profile_id', opportunity.owner_id));
  const authorized = assignments.find(assignment => can(profile, ACTIONS.AI_COMMERCIAL_DRAFT_RUN, crmResource(opportunity.owner_id, assignment)));
  return crmResource(opportunity.owner_id, authorized);
}

async function loadAgt003OpportunityContext(database, opportunityId) {
  const row = await must(database.from('v_psi_sales_opportunity_enriched').select(VIGIA_COPILOT_OPPORTUNITY_SELECT).eq('id', opportunityId).single());
  const interactions = await must(database.from('psi_sales_interactions')
    .select('id,interaction_type,occurred_at,created_at,notes')
    .eq('opportunity_id', opportunityId)
    .order('occurred_at', { ascending: false })
    .limit(20));
  const opportunity = {
    id: row.id,
    title: row.company_name,
    company_name: row.company_name,
    stage: row.stage_name,
    service: row.service_type_name,
    owner_name: row.owner_name,
    offer_value: row.offer_value,
    expected_close_date: row.expected_close_date,
    next_action_date: row.next_action_at,
  };
  return {
    opportunity,
    interactions,
    snapshotId: computeAgt003CopilotHash({ opportunity, interactions }),
  };
}

function createBackendAgt003CopilotApi(database) {
  return createAgt003CopilotApi({
    isConfigured: () => isAgt003CopilotConfigured(process.env),
    getConfig: () => getAgt003CopilotRuntimeConfig(process.env),
    resolveOpportunityResource: (opportunityId, profile) => resolveAgt003OpportunityResource(database, opportunityId, profile),
    loadOpportunityContext: opportunityId => loadAgt003OpportunityContext(database, opportunityId),
    loadApprovedAssets: () => loadVigiaApprovedAssets({ path: VIGIA_APPROVED_ASSETS_PATH }),
    claimRun: options => claimAgt003CopilotRun(database, options),
    findRunByKey: idempotencyKey => findAgt003CopilotRunByKey(database, idempotencyKey),
    findRunById: runId => findAgt003CopilotRunById(database, runId),
    createRuntime: () => createAgt003CopilotRuntime({ environment: process.env }),
    recordRun: options => recordAgt003CopilotRun(database, options),
    recordFailure: options => recordAgt003CopilotFailure(database, options),
    releaseClaim: options => releaseAgt003CopilotClaim(database, options),
    recordFeedback: options => recordAgt003CopilotFeedback(database, options),
  });
}

app.get('/api/vigia/priorities', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requirePrioritiesAction(currentProfile);
    const database = requireDb();
    const ownerIds = await resolveVigiaOwnerScope(database, currentProfile);
    const [viewRows, segmentRows] = await Promise.all([
      fetchVigiaRows(database, ownerIds),
      fetchVigiaCustomerSegments(database, ownerIds),
    ]);
    const scopedRows = attachVigiaCustomerSegments(viewRows, segmentRows);
    res.json(buildAgt003PrioritiesData(scopedRows));
  } catch (error) { sendAuthError(res, error); }
});
app.all('/api/vigia/priorities', (_req, res) => res.status(405).json({ error: 'Método no permitido.' }));

app.post('/api/vigia/copilot/generate', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    const result = await createBackendAgt003CopilotApi(requireDb()).generate({ profile, body: req.body });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) { sendAuthError(res, error); }
});
app.all('/api/vigia/copilot/generate', (_req, res) => res.status(405).json({ error: 'Método no permitido.' }));

app.post('/api/vigia/copilot/feedback', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    const result = await createBackendAgt003CopilotApi(requireDb()).feedback({ profile, body: req.body });
    res.status(201).json(result);
  } catch (error) { sendAuthError(res, error); }
});
app.all('/api/vigia/copilot/feedback', (_req, res) => res.status(405).json({ error: 'Método no permitido.' }));

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
app.all('/api/bootstrap', (_req, res) => res.status(405).json({ error: 'Método no permitido.' }));

app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireModuleAction(currentProfile, 'opportunities');
    const database = requireDb();
    const id = req.params.id;
    await ensureOpportunityAccess(database, id, currentProfile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW);
    const opportunity = await attachCommercialMetadata(database, await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', id).single()));
    const tenderSource = opportunity.service_type_code === 'licitacion_publica'
      ? await must(database.from('psi_public_tenders').select('url').eq('converted_opportunity_id', id).maybeSingle())
      : null;
    opportunity.source_url = tenderSource?.url || getTenderSourceUrlFromOpportunity(opportunity) || null;
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendAuthError(res, error); }
});


const TENDER_PIPELINE_VERSION = 'v1';
const tenderDocumentBucket = 'tender-documents';
const RUP_MAX_BYTES = 50 * 1024 * 1024;
const tenderDocumentTypes = ['pliego','estudios_previos','anexo_tecnico','adenda','formatos','otro'];
const TENDER_QUESTION_RESPONSE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];
const TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT = 8;
const TENDER_QUESTION_RESPONSE_ATTACHMENT_DOWNLOAD_TTL_SECONDS = 300;
const TENDER_QUESTION_RESPONSE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENDER_QUESTION_RESPONSE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
function isValidUuid(value) { return TENDER_QUESTION_RESPONSE_UUID_PATTERN.test(String(value || '')); }
function tenderQuestionResponseAttachmentPhysicalPath(opportunityId, responseId, uniqueName) {
  return `${opportunityId}/question-responses/${responseId}/${uniqueName}`;
}
function tenderQuestionResponseAttachmentStoragePath(opportunityId, responseId, uniqueName) {
  return `${tenderDocumentBucket}/${tenderQuestionResponseAttachmentPhysicalPath(opportunityId, responseId, uniqueName)}`;
}
function tenderQuestionResponseAttachmentBucketRelativePath(storagePath) {
  const prefix = `${tenderDocumentBucket}/`;
  return storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
}
const TENDER_QUESTION_RESPONSE_TICKET_TTL_MS = 30 * 60 * 1000;
function signTenderQuestionResponseTicket({ opportunityId, responseId, profileId, expiresAt }) {
  return createHmac('sha256', serviceKey).update(`${opportunityId}:${responseId}:${profileId}:${expiresAt}`).digest('hex');
}
function mintTenderQuestionResponseTicket({ opportunityId, responseId, profileId }) {
  const expiresAt = Date.now() + TENDER_QUESTION_RESPONSE_TICKET_TTL_MS;
  return `${expiresAt}.${signTenderQuestionResponseTicket({ opportunityId, responseId, profileId, expiresAt })}`;
}
function verifyTenderQuestionResponseTicket(ticket, { opportunityId, responseId, profileId }) {
  const raw = String(ticket || '');
  const separatorIndex = raw.indexOf('.');
  if (separatorIndex <= 0) return false;
  const expiresAt = Number(raw.slice(0, separatorIndex));
  const signature = raw.slice(separatorIndex + 1);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (Date.now() > expiresAt) return false;
  const expected = Buffer.from(signTenderQuestionResponseTicket({ opportunityId, responseId, profileId, expiresAt }), 'hex');
  const provided = Buffer.from(signature, 'hex');
  if (!expected.length || expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
function requireTenderQuestionResponseTicket(ticket, context) {
  if (!verifyTenderQuestionResponseTicket(ticket, context)) {
    const error = new Error('El ticket de la respuesta no es válido o expiró.');
    error.status = 403;
    throw error;
  }
}
function requireHumanTenderIdentity(profile) {
  if (profile?.identity_type != null && profile?.identity_type !== 'human') {
    const error = new Error('Las respuestas humanas de licitaciones no están disponibles para esta identidad.');
    error.status = 403;
    throw error;
  }
}
async function verifyTenderQuestionResponseAttachmentContent(database, attachment) {
  const bucketRelativePath = tenderQuestionResponseAttachmentBucketRelativePath(attachment.storage_path);
  const { data, error } = await database.storage.from(tenderDocumentBucket).download(bucketRelativePath);
  if (error) throw clientInputError(`No se pudo verificar el adjunto ${attachment.name}.`);
  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length !== attachment.size_bytes) throw clientInputError(`El tamaño del adjunto ${attachment.name} no coincide con el archivo cargado.`);
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== attachment.content_hash) throw clientInputError(`El contenido del adjunto ${attachment.name} no coincide con el archivo cargado.`);
  const actualMimeType = String(data.type || '').split(';')[0].trim().toLowerCase();
  if (actualMimeType && actualMimeType !== attachment.mime_type) throw clientInputError(`El tipo de archivo del adjunto ${attachment.name} no coincide con el archivo cargado.`);
  return { ...attachment, content_hash: actualHash };
}
function parseInteractionJson(notes) {
  try { return JSON.parse(notes || '{}'); } catch { return null; }
}
const RESERVED_TENDER_INTERACTION_KINDS = new Set([
  'tender_document_upload', 'tender_document_analysis', 'tender_document_import_error',
  'tender_document_clarification', 'tender_offer_preparation',
]);
function assertPublicInteractionPayload(notes) {
  const payload = typeof notes === 'string' ? parseInteractionJson(notes) : notes;
  if (payload?.kind && RESERVED_TENDER_INTERACTION_KINDS.has(payload.kind)) {
    const error = new Error('Este tipo de evento solo puede crearse por la ruta interna autorizada.');
    error.status = 403;
    throw error;
  }
}
function preparePublicInteractionNotes(notes) {
  assertPublicInteractionPayload(notes);
  const preparedNotes = typeof notes === 'object' && notes !== null ? JSON.stringify(notes) : String(notes || '');
  const normalizedNotes = preparedNotes.trim();
  if (!normalizedNotes) throw new Error('La nota del seguimiento es obligatoria.');
  return normalizedNotes;
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
    const currentLimit = Number(existing.data?.file_size_limit ?? existing.data?.fileSizeLimit);
    if (!Number.isFinite(currentLimit) || currentLimit <= 0 || currentLimit !== RUP_MAX_BYTES || existing.data?.public !== false) {
      const { error: updateError } = await database.storage.updateBucket(tenderDocumentBucket, { public: false, fileSizeLimit: RUP_MAX_BYTES });
      if (updateError) throw updateError;
    }
    return;
  }
  const { error } = await database.storage.createBucket(tenderDocumentBucket, { public: false, fileSizeLimit: RUP_MAX_BYTES });
  if (error && !String(error.message || '').toLowerCase().includes('already')) throw error;
}
async function extractTypedTextFromTenderFile(buffer, filename, mime = '') {
  return extractTenderDocumentText(buffer, filename, mime);
}
// Legacy interaction uploads still carry a plain string until they receive a
// governed document-version identity. Official/versioned documents retain the
// typed result and persist it through migration 065 below.
async function extractTextFromTenderFile(buffer, filename, mime = '') {
  const result = await extractTypedTextFromTenderFile(buffer, filename, mime);
  return resolveLegacyExtractedText(result, filename);
}
function tenderDocumentExtractionRelationMissing(response) {
  const code = String(response?.error?.code || '');
  const message = String(response?.error?.message || '');
  return Number(response?.status) === 404
    || ['42P01', 'PGRST205'].includes(code)
    || (/psi_tender_document_extractions/i.test(message) && /does not exist|could not find|schema cache/i.test(message));
}
async function loadTenderDocumentExtractionRows(database, documentVersionIds) {
  if (!documentVersionIds.length) return { available: true, rows: [] };
  const response = await database.from('psi_tender_document_extractions')
    .select('id,document_version_id,extractor_version,status,parser,extracted_text,text_hash,char_count,text_byte_count,gap_reason,created_at')
    .in('document_version_id', documentVersionIds)
    .order('created_at', { ascending: false });
  if (response.error) {
    if (tenderDocumentExtractionRelationMissing(response)) return { available: false, rows: [] };
    throw response.error;
  }
  return { available: true, rows: response.data || [] };
}
async function recordTenderDocumentExtraction(database, extraction, { opportunityId, tenderId, documentVersionId, actorId }) {
  const response = await database.rpc('psi_record_tender_document_extraction', buildTenderDocumentExtractionRpcParams(extraction, {
    opportunityId, tenderId, documentVersionId, actorId,
  }));
  if (response.error) throw response.error;
  return response.data;
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
    positives: positiveSignals.length ? [`El objeto y los documentos incluyen ${positiveSignals.join(', ')}; esto indica un encaje preliminar con servicios de seguridad que debe confirmarse contra las capacidades y requisitos de SN.`] : ['No se encontró evidencia textual suficiente para establecer un encaje preliminar con servicios de seguridad.'],
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
  const next_action = finalDecision.startsWith('DESCARTAR') ? 'Marcar como descartada si no hay señal comercial adicional.' : blockers.length ? 'Completar documentos críticos y actualizar la conclusión preliminar.' : 'Enviar a revisión de licitaciones con pliego, anexos y cruce RUP/financiero.';
  const committee_summary = `GO / NO GO SN — ${finalDecision}. ${opportunity.company_name}: ${hasCoreFit ? 'encaje preliminar con servicios SN' : 'encaje comercial débil'}; riesgo ${risk}. ${blockers.length ? `Bloqueadores: ${blockers.join(' ')}` : 'Base documental mínima disponible.'} Siguiente acción: ${next_action}`;
  return { decision: finalDecision, risk, executive_semaphore, commercial_fit, company_profile_crosscheck, habilitating_requirements, blockers, next_action, committee_summary };
}
function buildTenderDocumentAnalysis(opportunity, documents, companyProfile = {}) {
  const deepAnalysis = buildTenderDeepAnalysis(documents, companyProfile);
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
    normalized.includes('coordinador') ? 'El alcance documental incluye coordinación o supervisión operativa; falta validar perfiles y dedicación exigidos.' : 'No se encontró evidencia textual suficiente para confirmar una función de coordinación.',
    normalized.includes('capital de trabajo') ? 'El análisis detectó una referencia al capital de trabajo; falta validar el valor exigido y el soporte financiero de SN.' : 'El capital de trabajo exigido continúa pendiente de verificación documental.',
    normalized.includes('rup') ? 'El análisis detectó una referencia al RUP o a experiencia habilitante; falta validar su vigencia y equivalencia.' : 'La experiencia habilitante y el RUP continúan pendientes de verificación documental.',
    normalized.includes('cctv') || normalized.includes('videovigilancia') ? 'El alcance documental incluye videovigilancia; falta confirmar los requisitos técnicos y la capacidad aplicable de SN.' : 'No se encontró evidencia textual suficiente para confirmar un componente de videovigilancia.',
    normalized.includes('poliza') || normalized.includes('póliza') ? 'El análisis detectó una referencia a pólizas o seriedad de oferta; falta confirmar tipo, cobertura, cuantía y vigencia.' : 'Las pólizas requeridas continúan pendientes de verificación documental.'
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
    kind: 'tender_document_analysis', report_title: 'Preanálisis por reglas SIIO', status: 'analisis_generado', recommendation, risk, generated_at: new Date().toISOString(), deep_analysis: deepAnalysis,
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
async function getTenderDocumentRecords(database, opportunityId, { includeSignedUrls = true, includeExtractedText = false } = {}) {
  await requireTenderAnalysisFoundation(database);
  const interactions = await must(database.from('psi_sales_interactions').select('id,notes,occurred_at,created_at,created_by,psi_sales_profiles(full_name)').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento').order('created_at', { ascending: true }));
  const typedVersionsResponse = await database.from('psi_tender_document_versions')
    .select('id,opportunity_id,name,document_type,content_hash,storage_path,mime_type,size_bytes,current,source,source_document_id,source_url,version,extracted_text,created_at')
    .eq('opportunity_id', opportunityId)
    .eq('current', true);
  if (typedVersionsResponse.error) throw typedVersionsResponse.error;
  const typedVersions = typedVersionsResponse.data || [];
  const extractionRows = await loadTenderDocumentExtractionRows(database, typedVersions.map(version => version.id));
  const canonicalExtractions = selectCanonicalExtractionsByDocumentVersion(extractionRows.rows);
  const typedDocuments = typedVersions.map(version => mergeCanonicalExtractionIntoDocument({
    id: version.id, name: version.name, size: version.size_bytes, mime_type: version.mime_type,
    document_type: version.document_type, current: version.current, storage_path: version.storage_path,
    uploaded_at: version.created_at, auto_import: true,
    source: version.source, source_url: version.source_url, source_document_id: version.source_document_id,
    opportunity_id: version.opportunity_id, version: version.version, content_hash: version.content_hash,
  }, canonicalExtractions.get(version.id), version.extracted_text));
  const documents = [];
  const analyses = [];
  const importErrors = [];
  for (const row of interactions) {
    const payload = parseInteractionJson(row.notes);
    if (payload?.kind === 'tender_document_upload') documents.push(...(payload.documents || []).map(doc => ({ ...doc, interaction_id: row.id, uploaded_by: row.psi_sales_profiles?.full_name || null })));
    if (payload?.kind === 'tender_document_analysis') analyses.push({ ...payload, interaction_id: row.id, created_at: row.created_at, created_by_name: row.psi_sales_profiles?.full_name || null });
    if (payload?.kind === 'tender_document_import_error') importErrors.push({ kind: payload.kind, source: payload.source || null, created_at: row.created_at, failure_marker: 'fallo_importacion' });
  }
  const compatibleDocuments = mergeTenderDocumentRecords(typedDocuments, documents);
  const signed = includeSignedUrls ? await Promise.all(compatibleDocuments.map(async doc => {
    const { data } = await database.storage.from(tenderDocumentBucket).createSignedUrl(doc.storage_path, 3600);
    return { ...doc, signed_url: data?.signedUrl || null };
  })) : compatibleDocuments;
  const canonicalOnly = agt002AnalysisConfig.AGT002_CANONICAL_ONLY === true;
  const currentAnalysis = await getCurrentTenderAnalysis(
    database,
    opportunityId,
    compatibleDocuments.filter(document => document.current !== false),
    { canonicalOnly },
  );
  const latestAnalysisAttempt = canonicalOnly ? await getLatestAgt002AnalysisAttempt(database, opportunityId) : null;
  const presentedAnalysis = presentCurrentTenderAnalysis(currentAnalysis);
  const questionResponses = presentedAnalysis?.run_id ? await getTenderQuestionResponses(database, opportunityId, presentedAnalysis.run_id) : [];
  return {
    documents: includeExtractedText ? signed : signed.map(publicTenderDocumentProjection),
    analysis: presentedAnalysis,
    analyses,
    question_responses: questionResponses,
    import_error: importErrors.at(-1) || null,
    ...(canonicalOnly ? { analysis_attempt: latestAnalysisAttempt } : {}),
  };
}

function normalizeTenderQuestionResponseAttachment(item, opportunityId, responseId) {
  const name = cleanFileName(item?.name);
  if (!name.trim()) throw clientInputError('El nombre del adjunto no es válido.');
  const mimeType = String(item?.mime_type || '');
  if (!TENDER_QUESTION_RESPONSE_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType)) throw clientInputError('El tipo de archivo del adjunto no está permitido.');
  const sizeBytes = Number(item?.size_bytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_BYTES) throw clientInputError('El tamaño del adjunto no es válido.');
  const contentHash = String(item?.content_hash || '').trim().toLowerCase();
  if (!TENDER_QUESTION_RESPONSE_SHA256_PATTERN.test(contentHash)) throw clientInputError('El hash SHA-256 del adjunto no es válido.');
  const storagePath = String(item?.storage_path || '').trim();
  const expectedPrefix = tenderQuestionResponseAttachmentStoragePath(opportunityId, responseId, '');
  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..') || storagePath.includes('\\')) {
    throw clientInputError('La ruta de almacenamiento del adjunto no es válida.');
  }
  return { name, mime_type: mimeType, size_bytes: sizeBytes, content_hash: contentHash, storage_path: storagePath };
}
async function cleanupTenderQuestionResponseAttachments(database, attachments) {
  if (!attachments.length) return;
  try {
    await database.storage.from(tenderDocumentBucket).remove(attachments.map(item => tenderQuestionResponseAttachmentBucketRelativePath(item.storage_path)));
  } catch (cleanupError) {
    console.warn('tender_question_response_attachment_cleanup_failed', { event: 'tender_question_response_attachment_cleanup_failed', message: cleanupError?.message });
  }
}
async function getTenderQuestionResponseAttachments(database, opportunityId, responseIds) {
  if (!responseIds.length) return new Map();
  const response = await database.from('psi_tender_question_response_attachments')
    .select('id,response_id,name,mime_type,size_bytes,storage_path,uploaded_by,uploaded_at,psi_sales_profiles(full_name)')
    .eq('opportunity_id', opportunityId)
    .in('response_id', responseIds)
    .order('uploaded_at', { ascending: false });
  if (response.error) {
    const code = String(response.error.code || '');
    const message = String(response.error.message || '');
    const missingRelation = Number(response.status) === 404 || ['42P01', 'PGRST205'].includes(code) || (/psi_tender_question_response_attachments/i.test(message) && /does not exist|could not find|unhandled/i.test(message));
    if (missingRelation) return new Map();
    throw response.error;
  }
  const grouped = new Map();
  for (const row of response.data || []) {
    const { data } = await database.storage.from(tenderDocumentBucket).createSignedUrl(tenderQuestionResponseAttachmentBucketRelativePath(row.storage_path), TENDER_QUESTION_RESPONSE_ATTACHMENT_DOWNLOAD_TTL_SECONDS, { download: row.name });
    const list = grouped.get(row.response_id) || [];
    list.push({
      id: row.id, name: row.name, mime_type: row.mime_type, size_bytes: row.size_bytes,
      uploaded_by: row.uploaded_by, uploaded_by_name: row.psi_sales_profiles?.full_name || null,
      uploaded_at: row.uploaded_at, signed_url: data?.signedUrl || null,
    });
    grouped.set(row.response_id, list);
  }
  return grouped;
}
async function getTenderQuestionResponses(database, opportunityId, analysisRunId) {
  let query = database.from('psi_tender_question_responses')
    .select('id,opportunity_id,analysis_run_id,question_id,question_text,status,response,evidence_notes,responded_by,responded_at,psi_sales_profiles(full_name)')
    .eq('opportunity_id', opportunityId);
  if (analysisRunId) query = query.eq('analysis_run_id', analysisRunId);
  const response = await query.order('responded_at', { ascending: false }).limit(200);
  if (response.error) {
    const code = String(response.error.code || '');
    const message = String(response.error.message || '');
    const missingRelation = Number(response.status) === 404 || ['42P01', 'PGRST205'].includes(code) || (/psi_tender_question_responses/i.test(message) && /does not exist|could not find|unhandled/i.test(message));
    if (missingRelation) return [];
    throw response.error;
  }
  const rows = (response.data || []).map(row => ({ ...row, responded_by_name: row.psi_sales_profiles?.full_name || null, psi_sales_profiles: undefined }));
  const attachmentsByResponse = await getTenderQuestionResponseAttachments(database, opportunityId, rows.map(row => row.id));
  return rows.map(row => ({ ...row, attachments: attachmentsByResponse.get(row.id) || [] }));
}

function agt002HumanEvidenceFromResponses(responses) {
  const effective = new Map();
  for (const row of responses) {
    const identity = JSON.stringify([
      row.analysis_run_id, row.question_id, row.question_text, row.status,
      row.response, row.evidence_notes ?? null, row.responded_by,
    ]);
    const order = `${row.responded_at}\0${row.id}`;
    const previous = effective.get(identity);
    if (!previous || order < previous.order) effective.set(identity, { order, row });
  }
  return [...effective.values()].map(({ row }) => ({
    answer_id: row.id, question_id: row.question_id, question_text: row.question_text, status: row.status,
    response: row.response, evidence_notes: row.evidence_notes, responded_by: row.responded_by_name,
    responded_at: row.responded_at, analysis_run_id: row.analysis_run_id,
    source: { type: 'human', reference: `psi_tender_question_responses:${row.id}`, observed_at: row.responded_at },
  }));
}

/**
 * Connects a newly recorded human answer to a new append-only, versioned AGT-002
 * reanalysis: a new context version (carrying the human evidence) plus a new
 * canonical run, reusing the same Preview engine/persistence as the manual button.
 * Never creates or touches a GO/NO-GO decision; that stays exclusively human.
 */
async function reanalyzeAgt002AfterHumanAnswer(database, { opportunityId, analysisRunId, currentProfile }) {
  if (currentProfile?.identity_type === 'agent') return null;
  const canonicalOnly = agt002AnalysisConfig.AGT002_CANONICAL_ONLY === true;
  if (!canonicalOnly || !isAgt002PreviewConfigured(process.env)) return null;
  const priorRun = await must(database.from('psi_tender_analysis_runs').select('snapshot_id,tender_id').eq('id', analysisRunId).single());
  const snapshotId = priorRun.snapshot_id;
  const tenderId = priorRun.tender_id || await getTenderIdForOpportunity(database, opportunityId);

  const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(AGT002_OPPORTUNITY_CONTEXT_SELECT).eq('id', opportunityId).single());
  const contextV2Sections = await loadAgt002OpportunityContextV2(database, { opportunityId, tenderId, opportunity });
  const companyDossierV2 = await loadAgt002CompanyDossier(database);
  const records = await getTenderDocumentRecords(database, opportunityId, { includeExtractedText: true });
  const currentDocs = records.documents.filter(document => document.current !== false);
  const companyProfile = await getTenderCompanyProfile(database);
  const deepAnalysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);
  const humanEvidence = agt002HumanEvidenceFromResponses(await getTenderQuestionResponses(database, opportunityId, analysisRunId));

  const contextVersion = await registerAgt002ContextVersion(database, {
    opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId, actor_id: currentProfile.id,
    context: { snapshot_id: snapshotId, ...contextV2Sections, company_dossier: companyDossierV2, human_evidence: humanEvidence },
  });

  const config = getAgt002PreviewRuntimeConfig(process.env);
  const legalCorpusContext = await loadAgt002LegalCorpusContextIfEnabled(database);
  const idempotencyKey = computeAgt002PreviewIdempotencyKey({
    snapshotId,
    policyVersion: config.policyVersion,
    model: config.model,
    contextVersionId: contextVersion.id,
    legalCorpusVersionId: legalCorpusContext?.legal_corpus_version_id,
    contractVersion: agt002AnalysisConfig.AGT002_INTEGRAL_CONTRACT_V3 ? AGT002_INTEGRAL_V3_CONTRACT_VERSION : null,
  });
  let claimId = null;
  try {
    const claim = await claimAgt002PreviewRun(database, { idempotencyKey, dailyMaxRuns: config.dailyMaxRuns, maxConcurrent: config.maxConcurrent, leaseSeconds: config.leaseSeconds });
    if (claim.status === 'existing') {
      const existingRun = await findAgt002PreviewRun(database, idempotencyKey, { canonicalOnly });
      agt002AnalysisObservability.record('reanalysis_triggered', {
        opportunity_id: opportunityId, tender_id: tenderId, analysis_run_id: existingRun?.run_id,
        context_version_id: contextVersion.id, status: 'completed',
      });
      return { status: 'completed', context_version_id: contextVersion.id, analysis: presentCurrentTenderAnalysis(existingRun), reused: true };
    }
    if (claim.status !== 'claimed') {
      agt002AnalysisObservability.record('reanalysis_triggered', {
        opportunity_id: opportunityId, tender_id: tenderId, context_version_id: contextVersion.id, status: claim.status,
      });
      return { status: claim.status, context_version_id: contextVersion.id };
    }
    claimId = claim.claim_id;
    const analysisDocuments = agt002AnalysisConfig.AGT002_DOCUMENT_RETRIEVAL
      ? adaptAgt002RetrievalDocuments(currentDocs, { opportunityId, snapshotId })
      : currentDocs;
    const integralV3Governance = await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId);
    const engine = createAgt002PreviewRuntime({
          environment: process.env,
          countDailyRuns: () => countAgt002PreviewRunsToday(database),
          legalCorpusContext,
          ...(integralV3Governance ? {
            companyEvidenceRegistryEntries: integralV3Governance.companyEvidenceRegistryEntries,
            categoryOverrides: integralV3Governance.categoryOverrides,
            evidenceClassLinkByRequirementId: integralV3Governance.evidenceClassLinkByRequirementId,
            governanceProvenance: integralV3Governance.governanceProvenance,
            contextVersionId: contextVersion?.id ?? null,
          } : {}),
        });
    const envelope = await engine.analyze({ opportunity, documents: analysisDocuments, companyProfile, deepAnalysis, snapshotId, canonicalOnly, contextV2Sections: { ...contextV2Sections, company_dossier: companyDossierV2, human_evidence: humanEvidence } }, { idempotencyKey });
    const registeredRun = await registerAgt002PreviewAnalysis(database, {
      opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId, envelope, canonicalOnly, context_version_id: contextVersion.id,
    });
    agt002AnalysisObservability.record('canonical_run_recorded', {
      opportunity_id: opportunityId, tender_id: tenderId, analysis_run_id: registeredRun?.run_id, reused: false,
    });
    agt002AnalysisObservability.record('reanalysis_triggered', {
      opportunity_id: opportunityId, tender_id: tenderId, analysis_run_id: registeredRun?.run_id,
      context_version_id: contextVersion.id, status: 'completed',
    });
    return { status: 'completed', context_version_id: contextVersion.id, analysis: presentCurrentTenderAnalysis(registeredRun), reused: false };
  } catch (error) {
    console.warn('agt002_reanalysis_after_human_answer_failed', {
      event: 'agt002_reanalysis_after_human_answer_failed',
      ...toBoundedAgt002Error(error),
    });
    agt002AnalysisObservability.record('reanalysis_triggered', {
      opportunity_id: opportunityId, tender_id: tenderId, context_version_id: contextVersion.id, status: 'unavailable',
    });
    return { status: 'unavailable', context_version_id: contextVersion.id };
  } finally {
    if (claimId) {
      try { await releaseAgt002PreviewClaim(database, { idempotencyKey, claimId }); }
      catch { console.warn('agt002_preview_claim_release_failed', { event: 'agt002_preview_claim_release_failed' }); }
    }
  }
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

async function getTenderIdForOpportunity(database, opportunityId) {
  const tender = await must(database.from('psi_public_tenders')
    .select('id')
    .eq('converted_opportunity_id', opportunityId)
    .maybeSingle());
  if (!tender?.id) throw new Error('La oportunidad no está vinculada a una licitación para registrar el preanálisis.');
  return tender.id;
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
  const response = await safeOfficialFetch(url, DATOS_GOV_FETCH_POLICY, { maxBytes: 10 * 1024 * 1024, headers: { 'User-Agent': 'SN-CRM-SECOP-Documents/1.0 (+https://seguridad-nacional-crm.vercel.app)', 'Accept': 'application/json' } });
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
  const response = await safeOfficialFetch(doc.url_descarga_documento.url, SECOP_DOCUMENT_FETCH_POLICY, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept': 'application/pdf,application/octet-stream,*/*', 'Referer': referer } });
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
  validateOfficialHttpsUrl(processUrl, { ...ESU_FETCH_POLICY, allowedPath: /^\/procesos\/view\/\d+\/?$/i });
  const html = await fetchEsuHtml(processUrl);
  const detail = parseEsuProcessDetail(html, processUrl);
  return (detail.documents || []).filter(d => {
    if (!d.url || !/\/procesos\/descargar\//i.test(d.url)) return false;
    try { validateOfficialHttpsUrl(d.url, { ...ESU_FETCH_POLICY, allowedPath: /^\/procesos\/descargar\/\d+\/?$/i }); return true; }
    catch { return false; }
  });
}
async function downloadEsuDocument(doc, referer) {
  const response = await safeOfficialFetch(doc.url, { ...ESU_FETCH_POLICY, allowedPath: /^\/procesos\/descargar\/\d+\/?$/i }, { headers: { 'User-Agent': 'SN-CRM-ESU-Documents/1.0', 'Accept': 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/octet-stream,*/*', 'Referer': referer } });
  if (!response.ok) throw new Error(`Documento ${doc.name} respondió ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
function esuDocumentId(doc) {
  const match = String(doc?.url || '').match(/\/procesos\/descargar\/(\d+)/i);
  return match ? `esu-${match[1]}` : deterministicDocumentFallbackId({ name: doc?.name, url: doc?.url }).slice(0, 16);
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
async function getCurrentTenderDocumentVersion(database, opportunityId, source, sourceDocumentId) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  const normalizedSourceDocumentId = normalizeTenderSourceDocumentId(sourceDocumentId);
  const { data, error } = await database.from('psi_tender_document_versions')
    .select('id,content_hash,storage_path')
    .eq('opportunity_id', opportunityId)
    .eq('source', normalizedSource)
    .eq('source_document_id', normalizedSourceDocumentId)
    .eq('current', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return data;
  const extractionRows = await loadTenderDocumentExtractionRows(database, [data.id]);
  return {
    ...data,
    needs_extraction: extractionRows.available && extractionRows.rows.length === 0,
  };
}
async function refreshTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze = true } = {}) {
  await requireTenderAnalysisFoundation(database);
  const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
  const sourceUrl = getTenderSourceUrlFromOpportunity(opportunity);
  const officialUrl = secopOfficialUrl(sourceUrl);
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
      source_document_id: String(doc.id_documento || deterministicDocumentFallbackId({ name: doc.nombre_archivo, url: doc.url_descarga_documento.url }).slice(0, 24)),
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
  const tenderId = await getTenderIdForOpportunity(database, opportunityId);
  const refreshResults = await refreshTenderDocumentBatch(toDownload, async doc => {
    const sourceDocumentId = normalizeTenderSourceDocumentId(doc.source_document_id);
    const currentVersion = await getCurrentTenderDocumentVersion(database, opportunityId, sourceLabel, sourceDocumentId);
    return refreshOfficialTenderDocument({
      opportunityId,
      source: sourceLabel,
      document: { ...doc, source_document_id: sourceDocumentId },
      currentVersion,
      download: item => item.download(),
      cleanName: cleanFileName,
      extractText: extractTypedTextFromTenderFile,
      ensureStorage: () => ensureTenderBucket(database),
      upload: async (storagePath, buffer, mimeType) => {
        const { error } = await database.storage.from(tenderDocumentBucket).upload(storagePath, buffer, { contentType: mimeType, upsert: true });
        if (error) throw error;
      },
      recordVersion: async version => {
        const response = await database.rpc('psi_record_tender_document_version', {
          p_opportunity_id: opportunityId, p_tender_id: tenderId, p_source: sourceLabel, p_source_document_id: version.source_document_id,
          p_name: version.name, p_content_hash: version.content_hash, p_storage_path: version.storage_path,
          p_mime_type: version.mime_type || 'application/octet-stream', p_size_bytes: version.size_bytes,
          p_document_type: normalizeDocumentType(version.document_type, version.name), p_extracted_text: version.extracted_text,
          p_source_url: version.source_url || null, p_actor_id: currentProfile.id,
        });
        if (response.error) throw response.error;
        return response.data;
      },
      recordExtraction: ({ extraction, version }) => recordTenderDocumentExtraction(database, extraction, {
        opportunityId, tenderId, documentVersionId: version.id, actorId: currentProfile.id,
      }),
    });
  });
  const refreshSummary = summarizeTenderDocumentRefresh(refreshResults);
  await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_refresh', auto_import: true, ...sourceContext, opportunity: opportunity.company_name, ...refreshSummary, results: refreshResults }) }).select('id').single());
  const beginRefresh = await database.rpc('psi_begin_tender_document_refresh', { p_opportunity_id: opportunityId, p_tender_id: tenderId });
  if (beginRefresh.error) throw beginRefresh.error;
  const refreshToken = String(beginRefresh.data || '').trim();
  if (!refreshToken) throw new Error('No fue posible iniciar la actualización documental gobernada.');
  const refreshedRecords = await getTenderDocumentRecords(database, opportunityId, { includeExtractedText: true });
  const currentDocs = refreshedRecords.documents.filter(document => document.current !== false);
  const companyProfile = await getTenderCompanyProfile(database);
  const registeredSnapshot = await registerTenderDocumentSnapshot(database, {
    opportunity_id: opportunityId, tender_id: tenderId, actor_id: currentProfile.id, refresh_token: refreshToken,
    documents: currentDocs, company_profile: companyProfile,
  });
  const analysisGenerated = await runOptionalTenderAnalysis({
    analyze,
    loadCurrentDocuments: async () => currentDocs,
    generate: async documents => {
      const analysis = buildTenderDocumentAnalysis(opportunity, documents, companyProfile);
      const registered = await registerSiioRulesAnalysis(database, {
        opportunity_id: opportunityId, tender_id: tenderId, actor_id: currentProfile.id,
        documents, company_profile: companyProfile, result: analysis, snapshot_record: registeredSnapshot,
      });
      await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ ...analysis, analysis_run_id: registered.run_id, report_title: 'Preanálisis por reglas SIIO', auto_import: true, source: sourceLabel }) }).select('id').single());
    },
  });
  const records = await getTenderDocumentRecords(database, opportunityId);
  return {
    ...records,
    ...refreshSummary,
    imported_count: refreshSummary.new_count + refreshSummary.updated_count + refreshSummary.unchanged_count,
    analysis_generated: analysisGenerated && Boolean(records.analysis)
  };
}
async function convertTenderToOpportunity(database, tender, currentProfile) {
  if (!tender?.source || !tender?.entity || !tender?.title) throw new Error('Licitación inválida para convertir.');
  if (!(await tenderTableAvailable(database))) throw new Error('La tabla psi_public_tenders aún no existe. Aplica la migración para convertir licitaciones.');
  const stableKey = String(tender.stable_key || tender.id || stableTenderKey(tender)).trim();
  const tenderRecord = await getPersistedTenderByStableKey(database, stableKey);
  if (!isTenderTrackableStatus(tenderRecord)) throw trackingError('No se puede convertir una licitación cancelada, revocada o declarada desierta.', 409);
  const officialState = await revalidateTenderOfficialStatus(tenderRecord);
  if (!isTenderTrackableStatus(officialState)) throw trackingError('No se puede convertir una licitación cancelada, revocada o declarada desierta.', 409);
  const canonicalTender = dbTenderToPublic({ ...tenderRecord, status: officialState.status, raw: officialState.raw });
  const owner = await findTenderOwner(database, currentProfile);
  const payload = buildTenderOpportunityPayload(canonicalTender, currentProfile.role === 'comercial' ? currentProfile : owner);
  const conversion = await callTenderOpportunityConversion(database, tenderRecord.id, payload, tenderRecord.tracking_updated_at, currentProfile);
  const opportunityId = conversion.opportunity_id;
  if (isTenderDurablePipelineEnabled(process.env)) {
    const jobCreatedAt = Date.now();
    const job = await callCreateTenderProcessingJob(database, {
      tenderId: tenderRecord.id,
      opportunityId,
      pipelineVersion: TENDER_PIPELINE_VERSION,
      requestedBy: currentProfile.id,
    });
    agt002AnalysisObservability.record('job_created', {
      job_id: job.job_id, tender_id: tenderRecord.id, opportunity_id: opportunityId, status: job.status,
    });
    const dispatch = await dispatchTenderProcessingAfterConversion({
      enabled: agt002AnalysisConfig.TENDER_IMMEDIATE_DISPATCH,
      job,
      runOnce: () => createTenderProcessingWorker(buildTenderProcessingWorkerDeps(database)).runOnce({ timeBudgetMs: 45_000 }),
      onError: event => console.warn('tender_immediate_dispatch_failed', {
        event: event.event,
        job_id: event.job_id,
        error_code: event.error_code,
      }),
    });
    agt002AnalysisObservability.record('conversion_dispatched', {
      job_id: job.job_id, tender_id: tenderRecord.id, opportunity_id: opportunityId,
      dispatch_status: dispatch.status, worker_status: dispatch.worker_status || null, error_code: dispatch.error_code || null,
      duration_ms: Date.now() - jobCreatedAt,
    });
    if (job.status === 'created' && dispatch.status === 'dispatched') {
      // Only measurable on the immediate-dispatch path: creation and this claim happen
      // within the same request. Jobs picked up later by the scheduler have no JS-visible
      // creation timestamp to diff against (would require a schema change, out of scope here).
      agt002AnalysisObservability.record('first_claim_latency', {
        job_id: job.job_id, tender_id: tenderRecord.id, latency_ms: Date.now() - jobCreatedAt,
      });
    }
    return {
      id: opportunityId,
      tender_id: tenderRecord.id,
      duplicate: !!conversion.duplicate,
      processing: {
        job_id: job.job_id,
        status: job.status,
        current_step: job.current_step,
        automatic_analysis: isTenderAutoAnalysisEnabled(process.env),
        dispatch_status: dispatch.status,
      },
    };
  }
  let document_import_status = 'no_aplica';
  let document_import_error = null;
  if ((canonicalTender.source === 'SECOP II' || canonicalTender.source === 'ESU Contratación') && canonicalTender.url) {
    try {
      const importResult = await refreshTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze: true });
      document_import_status = importResult.analysis_generated ? 'analisis_generado' : 'fallo_importacion';
      if (!importResult.analysis_generated) {
        document_import_error = `No se pudo generar análisis: ${importResult.imported_count} documentos vigentes, ${importResult.failed_count} fallidos.`;
        await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_import_error', auto_import: true, source: canonicalTender.source, error: document_import_error }) }).select('id').single());
      }
    } catch (error) {
      document_import_status = 'fallo_importacion';
      document_import_error = error?.message || String(error);
      await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_import_error', auto_import: true, source: canonicalTender.source, error: document_import_error }) }).select('id').single());
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

async function exitTenderOpportunity(database, opportunityId, currentProfile, input) {
  await ensureTenderOpportunity(database, opportunityId, currentProfile);
  const { data: tender, error } = await database.from('psi_public_tenders')
    .select('id,internal_status,tracking_updated_at')
    .eq('converted_opportunity_id', opportunityId)
    .maybeSingle();
  if (error) throw error;
  if (!tender) { const missing = new Error('La licitación vinculada no existe.'); missing.status = 404; throw missing; }
  return await callTenderOpportunityExit(database, opportunityId, {
    destination: input?.destination,
    note: input?.reason,
    expected_tracking_updated_at: tender.tracking_updated_at,
  }, currentProfile);
}

async function resolveTenderPipelineSourceContext(database, opportunityId) {
  const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(opportunitySelect).eq('id', opportunityId).single());
  const sourceUrl = getTenderSourceUrlFromOpportunity(opportunity);
  const officialUrl = secopOfficialUrl(sourceUrl);
  if (/community\.secop\.gov\.co/i.test(officialUrl)) {
    return { opportunity, sourceLabel: 'SECOP II', referer: officialUrl, sourceUrl };
  }
  if (/^https:\/\/esucontratacion\.com\/procesos\/view\/\d+/i.test(sourceUrl)) {
    return { opportunity, sourceLabel: 'ESU Contratación', referer: sourceUrl, sourceUrl };
  }
  throw new Error('La importación automática solo está disponible para enlaces oficiales SECOP II o ESU Contratación.');
}

/** Wires the durable worker (tender-processing-worker.js) to real DB RPCs and
 * to the same SECOP/ESU/AGT-002 helpers already used by the synchronous
 * compat path, so the internal endpoint never re-implements that logic. */
function buildTenderProcessingWorkerDeps(database) {
  return {
    analysisConfig: agt002AnalysisConfig,
    observability: agt002AnalysisObservability,
    now: () => Date.now(),
    claimJob: () => claimTenderProcessingJob(database, { leaseSeconds: 90 }),
    updateJob: (jobId, leaseId, patch) => updateTenderProcessingJob(database, jobId, leaseId, patch, {
      releaseLease: agt002AnalysisConfig.TENDER_CONTINUOUS_DRAIN,
    }),
    recordImportItem: item => recordTenderImportItem(database, item),
    appendEvent: event => appendTenderProcessingEvent(database, event),

    revalidateOfficialStatus: async ({ tenderId }) => {
      const tenderRow = await must(database.from('psi_public_tenders').select('*').eq('id', tenderId).single());
      const officialState = await revalidateTenderOfficialStatus(tenderRow);
      return { terminal: !isTenderTrackableStatus(officialState) };
    },

    discoverDocuments: async ({ jobId, opportunityId }) => {
      const { sourceLabel, referer, sourceUrl } = await resolveTenderPipelineSourceContext(database, opportunityId);
      let docs;
      if (sourceLabel === 'SECOP II') {
        const process = await resolveSecopProcessByExactUrl(referer);
        docs = await listSecopDocumentsByPortfolio(process.id_del_portafolio);
      } else {
        docs = await listEsuDocumentsFromProcessUrl(sourceUrl);
      }
      const nameGetter = d => (sourceLabel === 'SECOP II' ? d.nombre_archivo : d.name);
      const selected = selectPriorityTenderDocuments(docs, nameGetter);
      const items = selected.map(doc => {
        const name = nameGetter(doc);
        const url = sourceLabel === 'SECOP II' ? doc.url_descarga_documento.url : doc.url;
        const sourceDocumentId = normalizeTenderSourceDocumentId(sourceLabel === 'SECOP II'
          ? String(doc.id_documento || deterministicDocumentFallbackId({ name: doc.nombre_archivo, url }).slice(0, 24))
          : esuDocumentId(doc));
        return { source: sourceLabel, sourceDocumentId, sourceUrl: url, name, critical: isCriticalTenderDocument(name) };
      });
      // Bounded concurrency: up to 40 items (selectPriorityTenderDocuments)
      // each need their own recordTenderImportItem RPC round-trip. Sequential
      // awaits ran past the caller's request timeout before updateJob could
      // run; unlimited Promise.all would still risk saturating the DB pool.
      await runInConcurrentChunks(items, TENDER_DISCOVERY_RECORD_CONCURRENCY, item =>
        recordTenderImportItem(database, { jobId, ...item, status: 'pending' }));
      return items;
    },

    importOneDocument: async ({ jobId, opportunityId, tenderId, document }) => {
      const { referer } = await resolveTenderPipelineSourceContext(database, opportunityId);
      const actor = await getTenderProcessingJobActor(database, jobId);
      const sourceDocumentId = normalizeTenderSourceDocumentId(document.sourceDocumentId);
      const currentVersion = await getCurrentTenderDocumentVersion(database, opportunityId, document.source, sourceDocumentId);
      const result = await refreshOfficialTenderDocument({
        opportunityId,
        source: document.source,
        document: {
          name: document.name,
          mime_type: document.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
          document_type: normalizeDocumentType('', document.name),
          source_url: document.sourceUrl,
          source_document_id: sourceDocumentId,
        },
        currentVersion,
        download: doc => (document.source === 'SECOP II'
          ? downloadSecopDocument({ url_descarga_documento: { url: doc.source_url }, nombre_archivo: doc.name }, referer)
          : downloadEsuDocument({ url: doc.source_url, name: doc.name }, referer)),
        cleanName: cleanFileName,
        extractText: extractTypedTextFromTenderFile,
        ensureStorage: () => ensureTenderBucket(database),
        upload: async (storagePath, buffer, mimeType) => {
          const { error } = await database.storage.from(tenderDocumentBucket).upload(storagePath, buffer, { contentType: mimeType, upsert: true });
          if (error) throw error;
        },
        recordVersion: async version => {
          const response = await database.rpc('psi_record_tender_document_version', {
            p_opportunity_id: opportunityId, p_tender_id: tenderId, p_source: document.source, p_source_document_id: version.source_document_id,
            p_name: version.name, p_content_hash: version.content_hash, p_storage_path: version.storage_path,
            p_mime_type: version.mime_type || 'application/octet-stream', p_size_bytes: version.size_bytes,
            p_document_type: normalizeDocumentType(version.document_type, version.name), p_extracted_text: version.extracted_text,
            p_source_url: version.source_url || null, p_actor_id: actor.requested_by,
          });
          if (response.error) throw response.error;
          return response.data;
        },
        recordExtraction: ({ extraction, version }) => recordTenderDocumentExtraction(database, extraction, {
          opportunityId, tenderId, documentVersionId: version.id, actorId: actor.requested_by,
        }),
      });
      return {
        status: result.status === 'unchanged' ? 'unchanged' : 'imported',
        hasText: true,
        documentVersionId: result.version?.id || currentVersion?.id || null,
      };
    },

    // Runs once the snapshot exists (§3 above), so every persisted chunk/gap can be tied
    // to a real snapshot_id. Covers every current document version for the opportunity —
    // no 12-document/3,000-character ceiling (that ceiling belongs only to
    // agt002-preview-input.js's historical evidence-preparation path, unrelated here) —
    // plus any import item that never became a document version (failed_terminal), which
    // the pure chunker (agt002-document-chunks.js) can never see. Persistence is via the
    // narrow service_role RPC (psi_record_tender_document_chunk, migration 052), which
    // itself dedupes by chunk_id so a retried phase never duplicates rows.
    chunkDocuments: async ({ jobId, tenderId, opportunityId, snapshotId }) => {
      const actor = await getTenderProcessingJobActor(database, jobId);
      const versionsResponse = await database.from('psi_tender_document_versions')
        .select('id,source_document_id,name,document_type,version,content_hash,extracted_text,current,created_at')
        .eq('opportunity_id', opportunityId)
        .eq('current', true);
      if (versionsResponse.error) throw versionsResponse.error;
      const versionRows = versionsResponse.data || [];
      const extractionRows = await loadTenderDocumentExtractionRows(database, versionRows.map(version => version.id));
      const canonicalExtractions = selectCanonicalExtractionsByDocumentVersion(extractionRows.rows);
      const currentVersions = canonicalizeTenderDocuments(versionRows).map(version =>
        mergeCanonicalExtractionIntoDocument(version, canonicalExtractions.get(version.id), version.extracted_text));

      const failedItemsResponse = await database.from('psi_tender_document_import_items')
        .select('source_document_id')
        .eq('job_id', jobId)
        .eq('status', 'failed_terminal');
      if (failedItemsResponse.error) throw failedItemsResponse.error;
      const failedTerminalItems = failedItemsResponse.data || [];

      const documents = currentVersions.map(version => ({
        document_id: version.source_document_id,
        document_version_id: version.id,
        opportunity_id: opportunityId,
        snapshot_id: snapshotId,
        document_type: version.document_type,
        name: version.name,
        version: version.version,
        content_hash: version.content_hash,
        current: version.current,
        extracted_text: version.extracted_text,
      }));

      const { chunks, gaps } = buildAgt002DocumentChunks(documents);

      await runInConcurrentChunks(chunks, TENDER_CHUNK_RECORD_CONCURRENCY, chunk => recordTenderDocumentChunk(database, {
        opportunityId, tenderId, documentVersionId: chunk.document_version_id, snapshotId,
        chunkId: chunk.chunk_id, evidenceRef: chunk.evidence_ref, documentType: chunk.document_type,
        name: chunk.name, version: chunk.version, contentHash: chunk.content_hash,
        page: chunk.page, section: chunk.section, chunkIndex: chunk.chunk_index,
        text: chunk.text, chunkHash: chunk.chunk_hash, current: chunk.current,
        precedence: chunk.precedence, supersededByAddendum: chunk.superseded_by_addendum,
        actorId: actor.requested_by,
      }));

      const gapDetails = [
        ...gaps.map(gap => ({ document_id: gap.document_id, reason: gap.reason })),
        ...failedTerminalItems.map(item => ({ document_id: item.source_document_id, reason: 'failed_terminal' })),
      ];

      return {
        documents: documents.length + failedTerminalItems.length,
        chunks: chunks.length,
        gaps: gapDetails.length,
        gapDetails,
      };
    },

    publishSnapshot: async ({ jobId, tenderId, opportunityId }) => {
      const actor = await getTenderProcessingJobActor(database, jobId);
      const beginRefresh = await database.rpc('psi_begin_tender_document_refresh', { p_opportunity_id: opportunityId, p_tender_id: tenderId });
      if (beginRefresh.error) throw beginRefresh.error;
      const refreshToken = String(beginRefresh.data || '').trim();
      if (!refreshToken) throw new Error('No fue posible iniciar la publicación gobernada del snapshot.');
      const records = await getTenderDocumentRecords(database, opportunityId, { includeExtractedText: true });
      const currentDocs = records.documents.filter(document => document.current !== false);
      const companyProfile = await getTenderCompanyProfile(database);
      const registered = await registerTenderDocumentSnapshot(database, {
        opportunity_id: opportunityId, tender_id: tenderId, actor_id: actor.requested_by,
        refresh_token: refreshToken, documents: currentDocs, company_profile: companyProfile,
      });
      return { id: registered.id };
    },

    requestAgt002: async ({ jobId, tenderId, opportunityId, snapshotId }) => {
      const actor = await getTenderProcessingJobActor(database, jobId);
      const canonicalOnly = agt002AnalysisConfig.AGT002_CANONICAL_ONLY === true;
      const attemptContext = { snapshot_id: snapshotId, opportunity_id: opportunityId, tender_id: tenderId };
      const appendAttempt = (attemptKey, state, extra = {}) => appendAgt002AnalysisAttempt(database, {
        ...attemptContext, attempt_key: attemptKey, state, ...extra,
      });
      const unavailable = async reason => {
        if (!canonicalOnly) return { status: 'rules_fallback' };
        const attemptKey = computeAgt002PreviewIdempotencyKey({ snapshotId, policyVersion: `unavailable:${reason}`, model: 'unavailable' });
        try {
          await appendAttempt(attemptKey, 'queued');
          await appendAttempt(attemptKey, 'unavailable', { error_code: `AGT002_${reason.toUpperCase()}`, error_message: 'Vig-IA no está disponible; el análisis queda pendiente.' });
        } catch (error) {
          return { status: 'error', error };
        }
        return { status: 'unavailable', reason };
      };

      if (!actor.analysis_authorized_by) return unavailable('not_authorized');
      if (!isTenderAutoAnalysisEnabled(process.env)) return unavailable('auto_disabled');
      if (!isAgt002PreviewConfigured(process.env)) return unavailable('not_configured');

      const opportunity = await must(database.from('v_psi_sales_opportunity_enriched').select(AGT002_OPPORTUNITY_CONTEXT_SELECT).eq('id', opportunityId).single());
      const contextV2Sections = await loadAgt002OpportunityContextV2(database, { opportunityId, tenderId, opportunity });
      const companyDossierV2 = await loadAgt002CompanyDossier(database);
      const records = await getTenderDocumentRecords(database, opportunityId, { includeExtractedText: true });
      const currentDocs = records.documents.filter(document => document.current !== false);
      const companyProfile = await getTenderCompanyProfile(database);
      const deepAnalysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);

      let claimId = null;
      let idempotencyKey = null;
      let attemptStarted = false;
      try {
        const config = getAgt002PreviewRuntimeConfig(process.env);
        const legalCorpusContext = await loadAgt002LegalCorpusContextIfEnabled(database);
        const contextVersion = canonicalOnly ? await registerAgt002ContextVersion(database, {
          opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId, actor_id: actor.requested_by,
          context: { snapshot_id: snapshotId, ...contextV2Sections, company_dossier: companyDossierV2, human_evidence: [] },
        }) : null;
        idempotencyKey = computeAgt002PreviewIdempotencyKey({
          snapshotId,
          policyVersion: config.policyVersion,
          model: config.model,
          contextVersionId: contextVersion?.id,
          legalCorpusVersionId: legalCorpusContext?.legal_corpus_version_id,
          contractVersion: agt002AnalysisConfig.AGT002_INTEGRAL_CONTRACT_V3 ? AGT002_INTEGRAL_V3_CONTRACT_VERSION : null,
        });
        const claim = await claimAgt002PreviewRun(database, { idempotencyKey, dailyMaxRuns: config.dailyMaxRuns, maxConcurrent: config.maxConcurrent, leaseSeconds: config.leaseSeconds });
        if (claim.status === 'existing') {
          const existingRun = await findAgt002PreviewRun(database, idempotencyKey, { canonicalOnly });
          if (!existingRun) return { status: 'error', error: new Error('La ejecución Vig-IA reservada no está disponible.') };
          return { status: 'completed', analysisRunId: existingRun.run_id };
        }
        if (claim.status === 'in_progress') return { status: 'busy' };
        if (claim.status === 'quota' || claim.status === 'saturated') {
          if (canonicalOnly) {
            await appendAttempt(idempotencyKey, 'queued');
            await appendAttempt(idempotencyKey, 'retry_wait', { error_code: `AGT002_${claim.status.toUpperCase()}`, error_message: 'Vig-IA está esperando capacidad.' });
          }
          return { status: claim.status };
        }
        claimId = claim.claim_id;
        if (canonicalOnly) {
          await appendAttempt(idempotencyKey, 'queued');
          attemptStarted = true;
          await appendAttempt(idempotencyKey, 'running');
        }
        const integralV3Governance = await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId);
        const engine = createAgt002PreviewRuntime({
          environment: process.env,
          countDailyRuns: () => countAgt002PreviewRunsToday(database),
          legalCorpusContext,
          ...(integralV3Governance ? {
            companyEvidenceRegistryEntries: integralV3Governance.companyEvidenceRegistryEntries,
            categoryOverrides: integralV3Governance.categoryOverrides,
            evidenceClassLinkByRequirementId: integralV3Governance.evidenceClassLinkByRequirementId,
            governanceProvenance: integralV3Governance.governanceProvenance,
            contextVersionId: contextVersion?.id ?? null,
          } : {}),
        });
        const analysisDocuments = adaptAgt002RetrievalDocuments(currentDocs, { opportunityId, snapshotId });
        const envelope = await engine.analyze({ opportunity, documents: analysisDocuments, companyProfile, deepAnalysis, snapshotId, canonicalOnly, contextV2Sections: { ...contextV2Sections, company_dossier: companyDossierV2 } }, { idempotencyKey });
        const registeredRun = await registerAgt002PreviewAnalysis(database, { opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId, envelope, canonicalOnly, context_version_id: contextVersion?.id });
        if (canonicalOnly) await appendAttempt(idempotencyKey, 'completed', { analysis_run_id: registeredRun.run_id });
        return { status: 'completed', analysisRunId: registeredRun.run_id };
      } catch (error) {
        if (canonicalOnly && attemptStarted && idempotencyKey) {
          try { await appendAttempt(idempotencyKey, 'unavailable', { error_code: error?.code || 'AGT002_UNAVAILABLE', error_message: 'Vig-IA no completó el análisis; se reintentará.' }); }
          catch { console.warn('agt002_attempt_state_failed', { event: 'agt002_attempt_state_failed' }); }
        }
        return { status: 'error', error };
      } finally {
        if (claimId && idempotencyKey) {
          try { await releaseAgt002PreviewClaim(database, { idempotencyKey, claimId }); }
          catch { console.warn('agt002_preview_claim_release_failed', { event: 'agt002_preview_claim_release_failed' }); }
        }
      }
    },
  };
}

export async function buildTenderOpportunitySummary(database, tender, { opportunity = null, latestDecision = null } = {}) {
  const fallback = {
    ...dbTenderToPublic(tender), opportunity_id: tender.converted_opportunity_id,
    document_count: 0, missing_document_count: 0, document_import_status: 'error', document_import_error: null,
    go_no_go: 'Pendiente', recommendation: 'Pendiente', decision: latestDecision?.decision || null,
    decided_by_name: latestDecision?.psi_sales_profiles?.full_name || null, decided_at: latestDecision?.decided_at || null,
    tender_offer_status: opportunity?.tender_offer_status || 'pendiente_decision', risk: 'Pendiente', checklist_progress: null,
    preparation_status: 'pendiente', human_pending_count: 0, sharepoint_status: 'pendiente', sharepoint_url: null,
    dossier_error: 'No se pudo cargar el expediente.'
  };
  try {
    const records = await getTenderDocumentRecords(database, tender.converted_opportunity_id, { includeSignedUrls: false });
    const preparationRecords = await getTenderOfferPreparationRecords(database, tender.converted_opportunity_id);
    const currentDocuments = records.documents.filter(document => document.current !== false);
    const analysis = records.analysis?.status === 'completed' && records.analysis?.current === true ? records.analysis : null;
    const importFailureIsCurrent = records.import_error && (!analysis || !analysis.created_at || !records.import_error.created_at || Date.parse(records.import_error.created_at) >= Date.parse(analysis.created_at));
    const preparation = preparationRecords.preparation;
    const recommendation = importFailureIsCurrent ? 'Pendiente' : analysis?.go_no_go?.decision || analysis?.recommendation || 'Pendiente';
    return {
      ...fallback, document_count: currentDocuments.length,
      missing_document_count: (analysis?.checklist || []).filter(item => /pendiente|falta/i.test(String(item))).length,
      document_import_status: importFailureIsCurrent ? 'fallo_importacion' : analysis ? 'analisis_generado' : currentDocuments.length ? 'documentos_cargados' : 'pendiente_documentos',
      document_import_error: importFailureIsCurrent ? 'La importación automática de documentos falló. Reintente o cargue los documentos manualmente.' : null,
      go_no_go: recommendation, recommendation, risk: importFailureIsCurrent ? 'Pendiente' : analysis?.go_no_go?.risk || analysis?.risk || 'Pendiente',
      checklist_progress: preparation?.checklist_summary || null, preparation_status: preparation?.status || 'pendiente',
      human_pending_count: preparation?.human_required_items?.length || 0, sharepoint_status: preparation?.sharepoint_folder?.status || 'pendiente',
      sharepoint_url: preparation?.sharepoint_folder?.url || null, dossier_error: null
    };
  } catch (_error) { return fallback; }
}
export const buildTenderDossierSummary = buildTenderOpportunitySummary;

const tenderDossierDefaultLimit = 50;
const tenderDossierMaxLimit = 50;
const tenderDossierMaxOffset = 10000;
const tenderOpportunityFilters = new Set(['all', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']);

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
  const filter = String(query.filter || 'all');
  if (!tenderOpportunityFilters.has(filter)) { const error = new Error('El filtro de oportunidades no es válido.'); error.status = 400; throw error; }
  return { limit, offset: parse(query.offset, 0, tenderDossierMaxOffset, 'El desplazamiento'), filter };
}

/** Lists one SQL-bounded page (at most 50 rows); only document enrichment is per-card. */
export async function listTenderOpportunities(database, query = {}) {
  const { limit, offset, filter } = parseTenderDossierPage(query);
  const page = await must(database.rpc('psi_list_tender_opportunity_page', {
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  }));
  if ((page || []).length > tenderDossierMaxLimit) throw new Error('La consulta paginada devolvió más de 50 oportunidades.');
  const rows = [];
  for (const pageRow of page || []) {
    const tender = pageRow?.tender;
    if (!tender) continue;
    rows.push(await buildTenderOpportunitySummary(database, tender, {
      opportunity: pageRow.opportunity || null,
      latestDecision: pageRow.latest_decision || null,
    }));
  }
  return { rows, limit, offset, filter };
}

async function sendTenderOpportunities(req, res) {
  const { profile: currentProfile } = await getAuthContext(req);
  requireTenderTrackingAccess(currentProfile);
  const result = await listTenderOpportunities(requireDb(), req.query);
  res.set('X-Tender-Opportunity-Limit', String(result.limit));
  res.set('X-Tender-Opportunity-Offset', String(result.offset));
  res.set('X-Tender-Opportunity-Filter', result.filter);
  res.set('X-Dossier-Limit', String(result.limit));
  res.set('X-Dossier-Offset', String(result.offset));
  res.json(result.rows);
}
app.get('/api/tender-opportunities', async (req, res) => { try { await sendTenderOpportunities(req, res); } catch (error) { sendError(res, error, error?.status || 400); } });
app.get('/api/tender-dossiers', async (req, res) => { try { await sendTenderOpportunities(req, res); } catch (error) { sendError(res, error, error?.status || 400); } });

app.get('/api/tender-offer-preparation', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.query.id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const formal = await getTenderGoNoGoDecision(database, opportunityId, currentProfile);
    if (formal.decision?.decision !== 'go') return res.json({ preparation: null, preparations: [], notes: [], decision: formal.decision, reason: 'no_go_or_pending' });
    res.json({ ...(await getTenderOfferPreparationRecords(database, opportunityId)), decision: formal.decision });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-go-no-go-decision', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await requireTenderAnalysisFoundation(database);
    res.json(await getTenderGoNoGoDecision(database, req.query.id, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-go-no-go-decision', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await requireTenderAnalysisFoundation(database);
    res.status(201).json(await callTenderGoNoGoDecision(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-offer-status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    res.json(await getTenderOfferStatus(requireDb(), req.query.id, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-offer-status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
    res.status(201).json(await callTenderOfferStatusTransition(requireDb(), req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-dossier-workspace', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.query.id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    res.json(await getTenderDossierWorkspace(database, opportunityId, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-item', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callCreateTenderDossierItem(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-item-action', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callAppendTenderDossierItemAction(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-artifact', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callCreateTenderDossierArtifact(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-artifact-version', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callAddTenderDossierArtifactVersion(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-artifact-review', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callRecordTenderDossierArtifactReview(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-dossier-seed', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await ensureTenderOpportunity(database, String(req.body?.opportunity_id || ''), currentProfile);
    res.status(201).json(await callSeedTenderDossier(database, req.body || {}, currentProfile));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-dossier-workbench', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    res.json(await getAgt002WorkbenchApi(database, String(req.query.id || ''), currentProfile, { enabled: isAgt002WorkbenchApiEnabled(process.env) }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.all('/api/tender-dossier-workbench', (req, res) => { res.status(405).json({ error: 'Método no permitido.' }); });

app.post('/api/tender-dossier-workbench/messages', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    res.status(201).json(await postAgt002MessageApi(database, req.body || {}, currentProfile, { enabled: isAgt002WorkbenchApiEnabled(process.env) }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.all('/api/tender-dossier-workbench/messages', (req, res) => { res.status(405).json({ error: 'Método no permitido.' }); });

app.post('/api/tender-dossier-workbench/jobs/retry', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    res.status(201).json(await postAgt002RetryApi(database, req.body || {}, currentProfile, { enabled: isAgt002WorkbenchApiEnabled(process.env) }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.all('/api/tender-dossier-workbench/jobs/retry', (req, res) => { res.status(405).json({ error: 'Método no permitido.' }); });

app.post('/api/tender-dossier-workbench/learning/review', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    res.status(201).json(await postAgt002LearningReviewApi(database, req.body || {}, currentProfile, { enabled: isAgt002WorkbenchApiEnabled(process.env) }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});
app.all('/api/tender-dossier-workbench/learning/review', (req, res) => { res.status(405).json({ error: 'Método no permitido.' }); });

function isAgt002WorkbenchWorkerAuthorized(req) {
  const authorization = String(req.headers.authorization || '');
  const bearerSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return secretMatches(process.env.AGT002_WORKBENCH_WORKER_SECRET, req.headers['x-agt002-workbench-secret'])
    || secretMatches(process.env.CRON_SECRET, bearerSecret);
}

// Semilla de inyección de dependencias exclusiva de pruebas: nunca se usa en
// producción (nada la asigna fuera de tests/). Permite probar el endpoint real vía
// HTTP en loopback sin requerir un puente HTTPS real; el puente de producción real
// se sigue construyendo desde configuración cuando esto es null.
let agt002WorkbenchWorkerTestBridgeClient = null;
export function __setAgt002WorkbenchWorkerTestBridgeClient(client) { agt002WorkbenchWorkerTestBridgeClient = client; }

async function runAgt002WorkbenchDrainOnce(req, res) {
  try {
    if (!isAgt002WorkbenchDrainEnabled(process.env)) { const error = new Error('No disponible.'); error.status = 404; throw error; }
    if (!isAgt002WorkbenchWorkerAuthorized(req)) { const error = new Error('No autorizado.'); error.status = 403; throw error; }
  } catch (error) { return sendError(res, error, error.status || 400); }
  try {
    const database = requireDb();
    const drain = createAgt002WorkbenchDrain({
      database,
      environment: process.env,
      ...(agt002WorkbenchWorkerTestBridgeClient ? { bridgeClient: agt002WorkbenchWorkerTestBridgeClient } : {}),
    });
    const result = await drain.runOnce();
    res.json(result);
  } catch (error) {
    console.warn('agt002_workbench_worker_run_failed', { event: 'agt002_workbench_worker_run_failed' });
    res.status(503).json({ error: 'La Mesa Vig-IA no está disponible en este momento.', code: 'AGT002_WORKBENCH_WORKER_UNAVAILABLE' });
  }
}
app.post('/api/tender-dossier-workbench/worker/run', runAgt002WorkbenchDrainOnce);
app.all('/api/tender-dossier-workbench/worker/run', (req, res) => { res.status(405).json({ error: 'Método no permitido.' }); });

app.post('/api/tender-offer-preparation-approve', async (req, res) => {
  try {
    await getAuthContext(req);
    res.status(410).json({ error: 'Use Registrar GO para iniciar la preparación de oferta.' });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-offer-preparation-note', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    await requireTenderGoForPreparation(database, opportunityId, currentProfile);
    const note = String(req.body.note || '').trim();
    if (!note) throw new Error('La nota para el asistente es obligatoria.');
    const payload = { kind: 'tender_offer_preparation_note', note, status: req.body.status || 'abierta', created_at: new Date().toISOString(), created_by: currentProfile.full_name || currentProfile.microsoft_email || currentProfile.id, purpose: 'Notas para el asistente / comercial: informar qué necesitamos del humano para seguir adelante.' };
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify(payload) }).select('id').single());
    res.status(201).json(await getTenderOfferPreparationRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-question-responses', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.query.opportunity_id || '');
    const analysisRunId = String(req.query.analysis_run_id || '');
    if (!opportunityId || !analysisRunId) throw new Error('Debe indicar la oportunidad y la corrida de análisis.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    res.json({ question_responses: await getTenderQuestionResponses(database, opportunityId, analysisRunId) });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-question-response-attachment-upload-url', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireHumanTenderIdentity(currentProfile);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw clientInputError('Debe indicar la oportunidad.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const attachmentIndex = Number(req.body.attachment_index);
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT) {
      throw clientInputError(`Cada respuesta admite máximo ${TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT} archivos de soporte.`);
    }
    const mimeType = String(req.body.mime_type || '');
    if (!TENDER_QUESTION_RESPONSE_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType)) throw clientInputError('El tipo de archivo del adjunto no está permitido.');
    const size = Number(req.body.size);
    if (!Number.isFinite(size) || size <= 0) throw clientInputError('Debe seleccionar un archivo de soporte válido.');
    if (size > TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_BYTES) throw clientInputError('El archivo de soporte supera 25 MiB.');
    const name = cleanFileName(req.body.name);
    if (!name.trim()) throw clientInputError('El nombre del archivo de soporte no es válido.');
    const requestedResponseId = req.body.response_id;
    let responseId;
    if (requestedResponseId === undefined || requestedResponseId === null || requestedResponseId === '') {
      responseId = randomUUID();
    } else {
      if (!isValidUuid(requestedResponseId)) throw clientInputError('El identificador de la respuesta no es válido.');
      responseId = String(requestedResponseId);
      requireTenderQuestionResponseTicket(req.body.response_ticket, { opportunityId, responseId, profileId: currentProfile.id });
    }
    const responseTicket = mintTenderQuestionResponseTicket({ opportunityId, responseId, profileId: currentProfile.id });
    const uniqueName = `${createHash('sha256').update(`question-response-attachment:${opportunityId}:${responseId}:${attachmentIndex}:${Date.now()}:${name}:${size}`).digest('hex').slice(0, 24)}-${name}`;
    await ensureTenderBucket(database);
    const path = tenderQuestionResponseAttachmentPhysicalPath(opportunityId, responseId, uniqueName);
    const { data, error } = await database.storage.from(tenderDocumentBucket).createSignedUploadUrl(path);
    if (error) throw error;
    res.json({ response_id: responseId, response_ticket: responseTicket, path, token: data.token, storage_path: tenderQuestionResponseAttachmentStoragePath(opportunityId, responseId, uniqueName) });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-question-responses', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireHumanTenderIdentity(currentProfile);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    const analysisRunId = String(req.body.analysis_run_id || '');
    if (!opportunityId || !analysisRunId) throw new Error('Debe indicar la oportunidad y la corrida de análisis.');
    await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const rawAttachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    if (rawAttachments.length > TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT) throw clientInputError(`Cada respuesta admite máximo ${TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT} archivos de soporte.`);
    let responseId;
    if (rawAttachments.length > 0) {
      if (!isValidUuid(req.body.response_id)) throw clientInputError('Debe indicar la respuesta asociada a los adjuntos.');
      responseId = String(req.body.response_id);
      requireTenderQuestionResponseTicket(req.body.response_ticket, { opportunityId, responseId, profileId: currentProfile.id });
    } else {
      responseId = randomUUID();
    }
    const attachments = rawAttachments.map(item => normalizeTenderQuestionResponseAttachment(item, opportunityId, responseId));
    let verifiedAttachments = [];
    if (attachments.length) {
      try {
        verifiedAttachments = await Promise.all(attachments.map(attachment => verifyTenderQuestionResponseAttachmentContent(database, attachment)));
      } catch (verificationError) {
        await cleanupTenderQuestionResponseAttachments(database, attachments);
        if (!verificationError?.status) verificationError.status = 400;
        throw verificationError;
      }
    }
    try {
      await must(database.rpc('psi_record_tender_question_response_with_attachments', {
        p_response_id: responseId,
        p_opportunity_id: opportunityId,
        p_analysis_run_id: analysisRunId,
        p_question_id: String(req.body.question_id || ''),
        p_question_text: String(req.body.question_text || ''),
        p_status: String(req.body.status || ''),
        p_response: String(req.body.response || ''),
        p_evidence_notes: null,
        p_responded_by: currentProfile.id,
        p_attachments: verifiedAttachments,
      }));
    } catch (rpcError) {
      const uniqueConflict = String(rpcError?.code || '') === '23505';
      if (!uniqueConflict) await cleanupTenderQuestionResponseAttachments(database, attachments);
      if (!rpcError?.status) rpcError.status = uniqueConflict ? 409 : 500;
      throw rpcError;
    }
    const reanalysis = await reanalyzeAgt002AfterHumanAnswer(database, { opportunityId, analysisRunId, currentProfile });
    const questionResponses = await getTenderQuestionResponses(database, opportunityId, analysisRunId);
    res.status(201).json({
      question_response: questionResponses.find(item => item.id === responseId) || null,
      question_responses: questionResponses,
      reanalysis,
    });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-documents', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await requireTenderAnalysisFoundation(database);
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
    await requireTenderAnalysisFoundation(database);
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    if (!files.length) throw new Error('Debe adjuntar al menos un documento.');
    const preparedFiles = files.slice(0, 8).map(file => {
      const name = cleanFileName(file.name);
      const buffer = Buffer.from(String(file.content_base64 || ''), 'base64');
      if (!buffer.length) throw new Error(`Archivo vacío: ${name}`);
      if (buffer.length > RUP_MAX_BYTES) throw new Error(`Archivo supera 50MB: ${name}`);
      return { file, name, buffer };
    });
    const tenderId = await getTenderIdForOpportunity(database, opportunityId);
    await ensureTenderBucket(database);
    const uploaded = [];
    for (const { file, name, buffer } of preparedFiles) {
      uploaded.push(await saveTenderDocumentBuffer(database, opportunityId, { name, buffer, mime_type: file.mime_type || '', document_type: file.document_type, current: file.current }, currentProfile));
    }
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ kind: 'tender_document_upload', opportunity: opportunity.company_name, documents: uploaded }) }).select('id').single());
    const beginRefresh = await database.rpc('psi_begin_tender_document_refresh', { p_opportunity_id: opportunityId, p_tender_id: tenderId });
    if (beginRefresh.error) throw beginRefresh.error;
    const refreshToken = String(beginRefresh.data || '').trim();
    if (!refreshToken) throw new Error('No fue posible abrir la actualización documental manual.');
    const records = await getTenderDocumentRecords(database, opportunityId, { includeSignedUrls: false, includeExtractedText: true });
    await registerTenderDocumentSnapshot(database, {
      opportunity_id: opportunityId,
      tender_id: tenderId,
      actor_id: currentProfile.id,
      documents: records.documents.filter(document => document.current !== false),
      company_profile: await getTenderCompanyProfile(database),
      refresh_token: refreshToken,
    });
    res.status(201).json(await getTenderDocumentRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-analyze', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await requireTenderAnalysisFoundation(database);
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const tenderId = await getTenderIdForOpportunity(database, opportunityId);
    const beginRefresh = await database.rpc('psi_begin_tender_document_refresh', { p_opportunity_id: opportunityId, p_tender_id: tenderId });
    if (beginRefresh.error) throw beginRefresh.error;
    const refreshToken = String(beginRefresh.data || '').trim();
    if (!refreshToken) throw new Error('No fue posible abrir el análisis documental gobernado.');
    const records = await getTenderDocumentRecords(database, opportunityId, { includeExtractedText: true });
    const currentDocs = records.documents.filter(d => d.current !== false);
    if (!currentDocs.length) throw new Error('Debe cargar documentos antes de analizar.');
    const companyProfile = await getTenderCompanyProfile(database);
    const analysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);
    const registered = await registerSiioRulesAnalysis(database, {
      opportunity_id: opportunityId, tender_id: tenderId, actor_id: currentProfile.id,
      documents: currentDocs, company_profile: companyProfile, result: analysis, refresh_token: refreshToken,
    });
    await must(database.from('psi_sales_interactions').insert({ opportunity_id: opportunityId, interaction_type: 'documento', created_by: currentProfile.id, occurred_at: new Date().toISOString(), notes: JSON.stringify({ ...analysis, analysis_run_id: registered.run_id, report_title: 'Preanálisis por reglas SIIO' }) }).select('id').single());
    res.json(await getTenderDocumentRecords(database, opportunityId));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-analyze-agent-preview', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.AI_ANALYSIS_RUN);
    const database = requireDb();
    await requireTenderAnalysisFoundation(database);
    const opportunityId = String(req.body.opportunity_id || '');
    const opportunity = await ensureTenderOpportunity(database, opportunityId, currentProfile);
    const tenderId = await getTenderIdForOpportunity(database, opportunityId);
    const contextV2Sections = await loadAgt002OpportunityContextV2(database, { opportunityId, tenderId });
    const companyDossierV2 = await loadAgt002CompanyDossier(database);
    const beginRefresh = await database.rpc('psi_begin_tender_document_refresh', { p_opportunity_id: opportunityId, p_tender_id: tenderId });
    if (beginRefresh.error) throw beginRefresh.error;
    const refreshToken = String(beginRefresh.data || '').trim();
    if (!refreshToken) throw new Error('No fue posible abrir el análisis documental gobernado.');
    const records = await getTenderDocumentRecords(database, opportunityId, { includeExtractedText: true });
    const currentDocs = records.documents.filter(document => document.current !== false);
    if (!currentDocs.length) throw new Error('Debe cargar documentos antes de analizar.');
    const companyProfile = await getTenderCompanyProfile(database);
    const registeredSnapshot = await registerTenderDocumentSnapshot(database, {
      opportunity_id: opportunityId, tender_id: tenderId, actor_id: currentProfile.id, refresh_token: refreshToken,
      documents: currentDocs, company_profile: companyProfile,
    });
    const deepAnalysis = buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile);
    const canonicalOnly = agt002AnalysisConfig.AGT002_CANONICAL_ONLY === true;
    const appendAttempt = (attemptKey, state, extra = {}) => appendAgt002AnalysisAttempt(database, {
      snapshot_id: registeredSnapshot.id, opportunity_id: opportunityId, tender_id: tenderId,
      attempt_key: attemptKey, state, ...extra,
    });
    const sendCanonicalState = (httpStatus, state, reason) => res.status(httpStatus).json({
      error: state === 'retry_wait' ? 'Vig-IA está esperando capacidad; el análisis sigue pendiente.' : 'Vig-IA no está disponible; no se generó un análisis alternativo.',
      analysis_engine: { requested: 'AGT-002', used: null, fallback: false, state, reason, human_review_required: true },
    });

    const useRulesFallback = async reason => {
      const rulesRun = await registerSiioRulesAnalysis(database, {
        opportunity_id: opportunityId, tender_id: tenderId, actor_id: currentProfile.id,
        documents: currentDocs, company_profile: companyProfile, result: deepAnalysis, snapshot_record: registeredSnapshot,
      });
      const payload = await getTenderDocumentRecords(database, opportunityId);
      return res.json({
        ...payload,
        analysis: presentCurrentTenderAnalysis(rulesRun) || payload.analysis,
        analysis_engine: { requested: 'AGT-002', used: 'siio_rules_v1', fallback: true, reason, human_review_required: true },
      });
    };

    if (!isAgt002PreviewConfigured(process.env)) {
      if (!canonicalOnly) return useRulesFallback('not_configured');
      const unavailableKey = computeAgt002PreviewIdempotencyKey({ snapshotId: registeredSnapshot.id, policyVersion: 'unavailable:not_configured', model: 'unavailable' });
      try {
        await appendAttempt(unavailableKey, 'queued');
        await appendAttempt(unavailableKey, 'unavailable', { error_code: 'AGT002_NOT_CONFIGURED', error_message: 'Vig-IA no está disponible; el análisis queda pendiente.' });
      } catch { console.warn('agt002_attempt_state_failed', { event: 'agt002_attempt_state_failed' }); }
      return sendCanonicalState(503, 'unavailable', 'not_configured');
    }
    let claimId = null;
    let idempotencyKey = null;
    let attemptStarted = false;
    const canonicalCorrelationId = randomUUID();
    const canonicalStartedAt = Date.now();
    let canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.RUNTIME_CONFIG;
    let bridgeInvocationStarted = false;
    try {
      const config = getAgt002PreviewRuntimeConfig(process.env);
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.LEGAL_CORPUS;
      const legalCorpusContext = await loadAgt002LegalCorpusContextIfEnabled(database);
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.CONTEXT_VERSION;
      const contextVersion = canonicalOnly ? await registerAgt002ContextVersion(database, {
        opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: registeredSnapshot.id, actor_id: currentProfile.id,
        context: { snapshot_id: registeredSnapshot.id, ...contextV2Sections, company_dossier: companyDossierV2, human_evidence: [] },
      }) : null;
      idempotencyKey = computeAgt002PreviewIdempotencyKey({
        snapshotId: registeredSnapshot.id,
        policyVersion: config.policyVersion,
        model: config.model,
        contextVersionId: contextVersion?.id,
        legalCorpusVersionId: legalCorpusContext?.legal_corpus_version_id,
        contractVersion: agt002AnalysisConfig.AGT002_INTEGRAL_CONTRACT_V3 ? AGT002_INTEGRAL_V3_CONTRACT_VERSION : null,
      });
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.CLAIM;
      const claim = await claimAgt002PreviewRun(database, { idempotencyKey, dailyMaxRuns: config.dailyMaxRuns, maxConcurrent: config.maxConcurrent, leaseSeconds: config.leaseSeconds });
      if (claim.status === 'existing') {
        const existingRun = await findAgt002PreviewRun(database, idempotencyKey, { canonicalOnly });
        if (!existingRun) throw new Error('La ejecución Vig-IA reservada no está disponible.');
        const payload = await getTenderDocumentRecords(database, opportunityId);
        return res.json({ ...payload, analysis: presentCurrentTenderAnalysis(existingRun), analysis_engine: { requested: 'AGT-002', used: 'AGT-002', fallback: false, state: 'completed', reused: true, human_review_required: true } });
      }
      if (claim.status === 'in_progress') {
        return res.status(409).json({ error: 'Vig-IA ya está procesando este snapshot.', analysis_engine: { requested: 'AGT-002', used: 'AGT-002', fallback: false, state: 'running', in_progress: true, human_review_required: true } });
      }
      if (claim.status === 'quota' || claim.status === 'saturated') {
        if (!canonicalOnly) return useRulesFallback(claim.status);
        await appendAttempt(idempotencyKey, 'queued');
        await appendAttempt(idempotencyKey, 'retry_wait', { error_code: `AGT002_${claim.status.toUpperCase()}`, error_message: 'Vig-IA está esperando capacidad.' });
        return sendCanonicalState(429, 'retry_wait', claim.status);
      }
      claimId = claim.claim_id;
      if (canonicalOnly) {
        await appendAttempt(idempotencyKey, 'queued');
        attemptStarted = true;
        await appendAttempt(idempotencyKey, 'running');
      }
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.GOVERNANCE;
      const integralV3Governance = await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId);
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.RUNTIME_CREATION;
      const engine = createAgt002PreviewRuntime({
          environment: process.env,
          countDailyRuns: () => countAgt002PreviewRunsToday(database),
          onBridgeInvocationStarted: () => { bridgeInvocationStarted = true; },
          legalCorpusContext,
          ...(integralV3Governance ? {
            companyEvidenceRegistryEntries: integralV3Governance.companyEvidenceRegistryEntries,
            categoryOverrides: integralV3Governance.categoryOverrides,
            evidenceClassLinkByRequirementId: integralV3Governance.evidenceClassLinkByRequirementId,
            governanceProvenance: integralV3Governance.governanceProvenance,
            contextVersionId: contextVersion?.id ?? null,
          } : {}),
        });
      const analysisDocuments = agt002AnalysisConfig.AGT002_DOCUMENT_RETRIEVAL
        ? adaptAgt002RetrievalDocuments(currentDocs, { opportunityId, snapshotId: registeredSnapshot.id })
        : currentDocs;
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.ENGINE_ANALYSIS;
      const envelope = await engine.analyze({ opportunity, documents: analysisDocuments, companyProfile, deepAnalysis, snapshotId: registeredSnapshot.id, canonicalOnly, contextV2Sections: { ...contextV2Sections, company_dossier: companyDossierV2 } }, { idempotencyKey });
      canonicalStage = AGT002_CANONICAL_PREVIEW_STAGES.PERSISTENCE;
      const registeredRun = await registerAgt002PreviewAnalysis(database, { opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: registeredSnapshot.id, envelope, canonicalOnly, context_version_id: contextVersion?.id });
      if (canonicalOnly) await appendAttempt(idempotencyKey, 'completed', { analysis_run_id: registeredRun.run_id });
      const payload = await getTenderDocumentRecords(database, opportunityId);
      return res.json({ ...payload, analysis: presentCurrentTenderAnalysis(registeredRun), analysis_engine: { requested: 'AGT-002', used: 'AGT-002', fallback: false, state: 'completed', reused: false, human_review_required: true } });
    } catch (error) {
      if (!canonicalOnly) {
        console.warn('agt002_preview_fallback', { event: 'agt002_preview_fallback', reason: 'preview_unavailable' });
        return useRulesFallback('preview_unavailable');
      }
      if (attemptStarted && idempotencyKey) {
        try { await appendAttempt(idempotencyKey, 'unavailable', { error_code: error?.code || 'AGT002_UNAVAILABLE', error_message: 'Vig-IA no completó el análisis; se reintentará.' }); }
        catch { console.warn('agt002_attempt_state_failed', { event: 'agt002_attempt_state_failed' }); }
      }
      agt002AnalysisObservability.record('canonical_preview_unavailable', {
        correlation_id: canonicalCorrelationId,
        stage: canonicalStage,
        error_code: error?.runtime_boundary_code || error?.code,
        bridge_invocation_started: bridgeInvocationStarted,
        duration_ms: Date.now() - canonicalStartedAt,
        opportunity_id: opportunityId,
        tender_id: tenderId,
        snapshot_id: registeredSnapshot.id,
      });
      return sendCanonicalState(503, 'unavailable', 'preview_unavailable');
    } finally {
      if (claimId && idempotencyKey) {
        try { await releaseAgt002PreviewClaim(database, { idempotencyKey, claimId }); }
        catch { console.warn('agt002_preview_claim_release_failed', { event: 'agt002_preview_claim_release_failed' }); }
      }
    }
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-documents-import', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    await requireTenderAnalysisFoundation(database);
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await refreshTenderDocumentsFromOfficialSource(database, opportunityId, currentProfile, { analyze: false }));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.get('/api/tender-processing-status', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireTenderTrackingAccess(currentProfile);
    const database = requireDb();
    const opportunityId = String(req.query.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    const { data, error } = await database
      .from('psi_tender_processing_jobs')
      .select('id,idempotency_key,status,current_step,documents_discovered,documents_processed,documents_imported,documents_unchanged,documents_failed,snapshot_id,analysis_run_id,last_error_code,last_error_message,updated_at')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.json({
        job_id: null, idempotency_key: null, status: 'no_job', current_step: null,
        counts: { discovered: 0, processed: 0, imported: 0, unchanged: 0, failed: 0 },
        failed_items: [],
        snapshot_id: null, analysis_run_id: null, last_error_code: null, last_error_message: null, updated_at: null,
      });
    }
    const { data: failedItems, error: failedItemsError } = await database
      .from('psi_tender_document_import_items')
      .select('id,name,status,last_error_code,last_error_message')
      .eq('job_id', data.id)
      .in('status', ['failed_retryable', 'failed_terminal'])
      .order('updated_at', { ascending: false });
    if (failedItemsError) throw failedItemsError;
    res.json({
      job_id: data.id,
      idempotency_key: data.idempotency_key,
      status: data.status,
      current_step: data.current_step,
      counts: {
        discovered: data.documents_discovered,
        processed: data.documents_processed,
        imported: data.documents_imported,
        unchanged: data.documents_unchanged,
        failed: data.documents_failed,
      },
      failed_items: failedItems || [],
      snapshot_id: data.snapshot_id,
      analysis_run_id: data.analysis_run_id,
      last_error_code: data.last_error_code,
      last_error_message: data.last_error_message,
      updated_at: data.updated_at,
    });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-processing-retry', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.LICITACIONES_CONVERT);
    const database = requireDb();
    const opportunityId = String(req.body?.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    const idempotencyKey = String(req.body?.idempotency_key || '').trim();
    if (!idempotencyKey) throw new Error('Debe indicar la clave de idempotencia del proceso.');
    const { data: job, error } = await database
      .from('psi_tender_processing_jobs')
      .select('id,tender_id,status,current_step,lease_id')
      .eq('opportunity_id', opportunityId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    if (!job) throw new Error('No existe un proceso de importación para esa oportunidad y clave.');
    if (job.status === 'cancelled' || job.status === 'completed') {
      const terminalError = new Error('No se puede reintentar un proceso cancelado o finalizado.');
      terminalError.status = 409;
      throw terminalError;
    }
    if (job.status !== 'needs_attention' && job.status !== 'retry_wait') {
      const stateError = new Error('El proceso no está en un estado que admita reintento.');
      stateError.status = 409;
      throw stateError;
    }
    const nextStatus = job.current_step === 'analysis' ? 'waiting_agent_capacity' : 'importing_documents';
    const updateResult = await database.rpc('psi_update_tender_processing_job', {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_patch: { status: nextStatus, next_attempt_at: new Date().toISOString(), last_error_code: null, last_error_message: null },
    });
    if (updateResult.error) throw updateResult.error;
    const eventResult = await database.rpc('psi_append_tender_tracking_event', {
      p_tender_id: job.tender_id,
      p_event_type: 'pipeline_queued',
      p_actor_kind: 'human',
      p_created_by: currentProfile.id,
      p_source_ref_type: 'job',
      p_source_ref_id: job.id,
      p_metadata: { retry: true },
      p_note: null,
      p_singular: false,
    });
    if (eventResult.error) throw eventResult.error;
    res.json({ job_id: job.id, status: nextStatus });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-analysis-authorize', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    requireAction(currentProfile, ACTIONS.AI_ANALYSIS_RUN);
    const database = requireDb();
    const jobId = String(req.body?.job_id || '');
    if (!jobId) throw new Error('Debe indicar el proceso de importación a autorizar.');
    const { error } = await database.rpc('psi_authorize_tender_analysis', { p_job_id: jobId, p_authorized_by: currentProfile.id });
    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (error) { sendError(res, error, error?.status || 400); }
});

function secretMatches(expectedValue, providedValue) {
  const expected = Buffer.from(String(expectedValue || ''), 'utf8');
  const provided = Buffer.from(String(providedValue || ''), 'utf8');
  return expected.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isTenderWorkerSchedulerAuthorized(req) {
  const authorization = String(req.headers.authorization || '');
  const bearerSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return secretMatches(process.env.TENDER_WORKER_SCHEDULER_SECRET, req.headers['x-tender-worker-secret'])
    || secretMatches(process.env.CRON_SECRET, bearerSecret);
}

async function runAgt002FixedSnapshotOperator(req, res) {
  try {
    let database = null;
    const getDatabase = () => {
      if (!database) database = requireDb();
      return database;
    };
    const result = await runAgt002FixedSnapshotReanalysis({
      authorize: () => isTenderWorkerSchedulerAuthorized(req),
      body: req.body,
      analysisConfig: agt002AnalysisConfig,
      autoAnalysisEnabled: isTenderAutoAnalysisEnabled(process.env),
      loadPriorRun: async analysisRunId => {
        const response = await getDatabase().from('psi_tender_analysis_runs')
          .select('id,opportunity_id,snapshot_id,tender_id,producer,method,status,canonical')
          .eq('id', analysisRunId)
          .maybeSingle();
        if (response.error) throw response.error;
        return response.data;
      },
      loadSnapshot: async snapshotId => {
        const response = await getDatabase().from('psi_tender_document_snapshots')
          .select('id,opportunity_id,tender_id,actor_id,document_manifest')
          .eq('id', snapshotId)
          .maybeSingle();
        if (response.error) throw response.error;
        return response.data;
      },
      loadCurrentDocuments: async opportunityId => {
        const records = await getTenderDocumentRecords(getDatabase(), opportunityId, { includeSignedUrls: false, includeExtractedText: true });
        return records.documents.filter(document => document.current !== false);
      },
      loadActorProfile: async actorId => {
        const response = await getDatabase().from('psi_sales_profiles')
          .select('id,identity_type,active')
          .eq('id', actorId)
          .maybeSingle();
        if (response.error) throw response.error;
        return response.data;
      },
      reanalyze: input => reanalyzeAgt002AfterHumanAnswer(getDatabase(), input),
    });
    res.json(result);
  } catch (error) {
    const safeError = sanitizeAgt002FixedSnapshotError(error);
    sendError(res, safeError, safeError.status);
  }
}

async function runTenderProcessingWorker(req, res) {
  try {
    if (!isTenderDurablePipelineEnabled(process.env)) { const error = new Error('No disponible.'); error.status = 404; throw error; }
    if (!isTenderWorkerSchedulerAuthorized(req)) { const error = new Error('No autorizado.'); error.status = 403; throw error; }
    const database = requireDb();
    const worker = createTenderProcessingWorker(buildTenderProcessingWorkerDeps(database));
    const drain = createTenderProcessingDrain({ worker, analysisConfig: agt002AnalysisConfig, timeBudgetMs: 45_000 });
    const result = await drain.run();
    res.json({ processed: result.processed, iterations: result.iterations, status: result.last_status, stop_reason: result.stop_reason });
  } catch (error) { sendError(res, error, error?.status || 400); }
}

app.post('/api/tender-processing-worker-run', runTenderProcessingWorker);
app.get('/api/tender-processing-worker-run', runTenderProcessingWorker);
app.post('/api/agt002-reanalyze-fixed-snapshot', runAgt002FixedSnapshotOperator);

app.post('/api/tender-opportunity-discard', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await markTenderOpportunityDiscarded(database, opportunityId, currentProfile, req.body.reason));
  } catch (error) { sendError(res, error, error?.status || 400); }
});

app.post('/api/tender-opportunity-exit', async (req, res) => {
  try {
    const { profile: currentProfile } = await getAuthContext(req);
    const database = requireDb();
    const opportunityId = String(req.body?.opportunity_id || '');
    if (!opportunityId) throw new Error('Debe indicar la oportunidad.');
    res.json(await exitTenderOpportunity(database, opportunityId, currentProfile, req.body || {}));
  } catch (error) {
    sendError(res, error, /desactualizado/i.test(error?.message || '') ? 409 : error?.status || 400);
  }
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
    const notes = preparePublicInteractionNotes(req.body.notes);
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
    const tenderSource = opportunity.service_type_code === 'licitacion_publica'
      ? await must(database.from('psi_public_tenders').select('url').eq('converted_opportunity_id', id).maybeSingle())
      : null;
    opportunity.source_url = tenderSource?.url || getTenderSourceUrlFromOpportunity(opportunity) || null;
    const interactions = await must(database.from('psi_sales_interactions').select('*, psi_sales_profiles(full_name)').eq('opportunity_id', id).order('occurred_at', { ascending: false }));
    res.json({ opportunity, interactions });
  } catch (error) { sendAuthError(res, error); }
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
    const notes = preparePublicInteractionNotes(req.body.notes);
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
