import { strict as assert } from 'node:assert';
import {
  ACTIONS,
  can,
  hasAreaScope,
  hasPermission,
  requireAction,
} from '../access-control.js';

const profile = (role, overrides = {}) => ({
  id: `user-${role}`,
  role,
  active: true,
  areas: [],
  permissions: [],
  ...overrides,
});

const human = (role, overrides = {}) => profile(role, { identity_type: 'human', ...overrides });
const agent = (overrides = {}) => profile('admin', { id: 'agent-1', identity_type: 'agent', ...overrides });
const commercialDirector = (areas, overrides = {}) => human('director', { areas, ...overrides });
const tenderUser = (role, overrides = {}) => human(role, { permissions: ['licitaciones'], ...overrides });

const runCases = (label, cases, fn) => {
  for (const scenario of cases) {
    assert.equal(fn(scenario), scenario.expected, `${label}: ${scenario.name}`);
  }
};

assert.equal(Object.isFrozen(ACTIONS), true, 'ACTIONS debe estar congelado');
const actionValues = Object.values(ACTIONS);
assert.ok(actionValues.length >= 27, 'ACTIONS debe exponer todos los códigos estables requeridos');
assert.equal(new Set(actionValues).size, actionValues.length, 'todos los códigos de acción deben ser únicos');
assert.ok(actionValues.every((value) => typeof value === 'string' && value.length > 0), 'todos los códigos de acción deben ser strings no vacíos');

runCases('hasPermission', [
  { name: 'permiso exacto activo', profile: tenderUser('comercial'), code: 'licitaciones', expected: true },
  { name: 'recorta únicamente el código solicitado', profile: tenderUser('comercial'), code: ' licitaciones ', expected: true },
  { name: 'sin coincidencia por mayúsculas', profile: tenderUser('comercial'), code: 'LICITACIONES', expected: false },
  { name: 'sin coincidencia por substring', profile: tenderUser('comercial'), code: 'licit', expected: false },
  { name: 'permiso almacenado con espacios no coincide', profile: tenderUser('comercial', { permissions: [' licitaciones '] }), code: 'licitaciones', expected: false },
  { name: 'perfil inactivo', profile: tenderUser('comercial', { active: false }), code: 'licitaciones', expected: false },
  { name: 'permissions no es arreglo', profile: human('comercial', { permissions: 'licitaciones' }), code: 'licitaciones', expected: false },
  { name: 'código vacío', profile: tenderUser('comercial'), code: '   ', expected: false },
  { name: 'perfil nulo', profile: null, code: 'licitaciones', expected: false },
], ({ profile: candidate, code }) => hasPermission(candidate, code));

const scopedDirector = commercialDirector([
  { area_code: 'comercial', subarea_code: null },
  { area_code: 'siio', subarea_code: 'tecnologia' },
]);
runCases('hasAreaScope', [
  { name: 'admin cubre área válida', profile: human('admin'), area: 'siio', subarea: null, expected: true },
  { name: 'gerencia cubre subárea válida', profile: human('gerencia'), area: 'siio', subarea: 'tecnologia', expected: true },
  { name: 'director asignado a área completa cubre subárea', profile: scopedDirector, area: 'comercial', subarea: 'ventas', expected: true },
  { name: 'director con subárea exacta cubre esa subárea', profile: scopedDirector, area: 'siio', subarea: 'tecnologia', expected: true },
  { name: 'director no cubre subárea distinta', profile: scopedDirector, area: 'siio', subarea: 'operaciones', expected: false },
  { name: 'asignación de subárea no cubre solicitud de área completa', profile: scopedDirector, area: 'siio', subarea: null, expected: false },
  { name: 'director cubre la segunda de múltiples áreas', profile: scopedDirector, area: 'comercial', subarea: null, expected: true },
  { name: 'director no cubre área externa', profile: scopedDirector, area: 'licitaciones', subarea: null, expected: false },
  { name: 'comercial usa solamente asignación explícita', profile: human('comercial', { areas: [{ area_code: 'comercial', subarea_code: 'norte' }] }), area: 'comercial', subarea: 'norte', expected: true },
  { name: 'comercial no infiere cobertura de área completa', profile: human('comercial', { areas: [{ area_code: 'comercial', subarea_code: 'norte' }] }), area: 'comercial', subarea: null, expected: false },
  { name: 'asignación malformada se ignora', profile: commercialDirector([{ area_code: 'comercial', subarea_code: 7 }]), area: 'comercial', subarea: 'norte', expected: false },
  { name: 'área vacía falla cerrada', profile: human('admin'), area: '  ', subarea: null, expected: false },
  { name: 'agent no hereda cobertura de admin', profile: agent(), area: 'siio', subarea: null, expected: false },
], ({ profile: candidate, area, subarea }) => hasAreaScope(candidate, area, subarea));

runCases('usuarios y navegación', [
  { name: 'admin administra usuarios', profile: human('admin'), action: ACTIONS.USERS_MANAGE, resource: {}, expected: true },
  { name: 'gerencia no administra usuarios', profile: human('gerencia'), action: ACTIONS.USERS_MANAGE, resource: {}, expected: false },
  { name: 'director no administra usuarios', profile: commercialDirector([{ area_code: 'comercial', subarea_code: null }]), action: ACTIONS.USERS_MANAGE, resource: {}, expected: false },
  { name: 'admin inactivo no administra usuarios', profile: human('admin', { active: false }), action: ACTIONS.USERS_MANAGE, resource: {}, expected: false },
  { name: 'admin ve navegación gerencial', profile: human('admin'), action: ACTIONS.NAV_GERENCIAL_VIEW, resource: {}, expected: true },
  { name: 'director con área ve navegación gerencial', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.NAV_GERENCIAL_VIEW, resource: {}, expected: true },
  { name: 'director sin área no ve navegación gerencial', profile: human('director'), action: ACTIONS.NAV_GERENCIAL_VIEW, resource: {}, expected: false },
  { name: 'junta no ve navegación gerencial en vivo', profile: human('junta'), action: ACTIONS.NAV_GERENCIAL_VIEW, resource: {}, expected: false },
  { name: 'comercial ve navegación comercial', profile: human('comercial'), action: ACTIONS.NAV_COMERCIAL_VIEW, resource: {}, expected: true },
  { name: 'director con Comercial ve navegación comercial', profile: commercialDirector([{ area_code: 'comercial', subarea_code: null }]), action: ACTIONS.NAV_COMERCIAL_VIEW, resource: {}, expected: true },
  { name: 'director sin Comercial no ve navegación comercial', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.NAV_COMERCIAL_VIEW, resource: {}, expected: false },
  { name: 'admin necesita permiso para navegación de licitaciones', profile: human('admin'), action: ACTIONS.NAV_LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'comercial con permiso ve navegación de licitaciones', profile: tenderUser('comercial'), action: ACTIONS.NAV_LICITACIONES_VIEW, resource: {}, expected: true },
  { name: 'colaborador no ve navegación de licitaciones', profile: tenderUser('colaborador'), action: ACTIONS.NAV_LICITACIONES_VIEW, resource: {}, expected: false },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

const ownOpportunity = { area_code: 'comercial', subarea_code: 'norte', owner_id: 'user-comercial' };
runCases('CRM', [
  { name: 'gerencia ve pipeline', profile: human('gerencia'), action: ACTIONS.CRM_PIPELINE_SUMMARY_VIEW, resource: {}, expected: true },
  { name: 'director con alcance Comercial ve pipeline de su subárea', profile: commercialDirector([{ area_code: 'comercial', subarea_code: 'norte' }]), action: ACTIONS.CRM_PIPELINE_SUMMARY_VIEW, resource: { area_code: 'comercial', subarea_code: 'norte' }, expected: true },
  { name: 'director fuera de subárea no ve pipeline', profile: commercialDirector([{ area_code: 'comercial', subarea_code: 'norte' }]), action: ACTIONS.CRM_PIPELINE_SUMMARY_VIEW, resource: { area_code: 'comercial', subarea_code: 'sur' }, expected: false },
  { name: 'director sin área no ve pipeline', profile: human('director'), action: ACTIONS.CRM_PIPELINE_SUMMARY_VIEW, resource: { area_code: 'comercial' }, expected: false },
  { name: 'comercial ve resumen de equipo', profile: human('comercial'), action: ACTIONS.CRM_PIPELINE_SUMMARY_VIEW, resource: {}, expected: true },
  { name: 'comercial ve oportunidad propia', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, resource: ownOpportunity, expected: true },
  { name: 'comercial no ve oportunidad ajena', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, resource: { ...ownOpportunity, owner_id: 'other' }, expected: false },
  { name: 'comercial falla cerrado sin owner', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, resource: { area_code: 'comercial' }, expected: false },
  { name: 'comercial crea solo para sí mismo', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_CREATE, resource: ownOpportunity, expected: true },
  { name: 'comercial no crea para otro', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_CREATE, resource: { ...ownOpportunity, owner_id: 'other' }, expected: false },
  { name: 'comercial no crea sin owner', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_CREATE, resource: { area_code: 'comercial' }, expected: false },
  { name: 'comercial edita propia', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_EDIT, resource: ownOpportunity, expected: true },
  { name: 'director con alcance Comercial reasigna', profile: commercialDirector([{ area_code: 'comercial', subarea_code: null }]), action: ACTIONS.CRM_OPPORTUNITY_REASSIGN, resource: ownOpportunity, expected: true },
  { name: 'comercial no reasigna', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_REASSIGN, resource: ownOpportunity, expected: false },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

runCases('licitaciones', [
  { name: 'admin sin permiso no consulta', profile: human('admin'), action: ACTIONS.LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'gerencia con permiso sincroniza', profile: tenderUser('gerencia'), action: ACTIONS.LICITACIONES_SYNC, resource: {}, expected: true },
  { name: 'director con permiso propone descarte', profile: tenderUser('director'), action: ACTIONS.LICITACIONES_DISCARD_PROPOSE, resource: {}, expected: true },
  { name: 'comercial con permiso recomienda go-no-go', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND, resource: {}, expected: true },
  { name: 'comercial con permiso no aprueba descarte', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_DISCARD_APPROVE, resource: {}, expected: false },
  { name: 'director con permiso aprueba go-no-go', profile: tenderUser('director'), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: {}, expected: true },
  { name: 'director sin permiso no aprueba', profile: human('director'), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: {}, expected: false },
  { name: 'no existe fallback por correo', profile: human('admin', { microsoft_email: 'directora.licitaciones@seguridadnacional.co' }), action: ACTIONS.LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'colaborador con permiso sigue denegado', profile: tenderUser('colaborador'), action: ACTIONS.LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'agent técnico puede recomendar', profile: agent(), action: ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND, resource: { technical_authorized: true }, expected: true },
  { name: 'agent técnico no aprueba', profile: agent(), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: { technical_authorized: true }, expected: false },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

runCases('SIIO', [
  { name: 'gerencia ve cualquier área', profile: human('gerencia'), action: ACTIONS.SIIO_AREA_VIEW, resource: { area_code: 'siio' }, expected: true },
  { name: 'director crea dentro de su área', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.SIIO_SUBJECT_CREATE, resource: { area_code: 'siio' }, expected: true },
  { name: 'director no edita fuera de su área', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.SIIO_SUBJECT_EDIT, resource: { area_code: 'comercial' }, expected: false },
  { name: 'comercial no ejecuta acción general de área', profile: human('comercial'), action: ACTIONS.SIIO_AREA_VIEW, resource: { area_code: 'siio' }, expected: false },
  { name: 'colaborador ve asignación propia', profile: human('colaborador'), action: ACTIONS.SIIO_ASSIGNMENT_VIEW, resource: { area_code: 'siio', assignee_id: 'user-colaborador' }, expected: true },
  { name: 'colaborador actualiza asignación propia', profile: human('colaborador'), action: ACTIONS.SIIO_ASSIGNMENT_UPDATE, resource: { area_code: 'siio', assignee_id: 'user-colaborador' }, expected: true },
  { name: 'colaborador solicita cierre propio', profile: human('colaborador'), action: ACTIONS.SIIO_CLOSE_REQUEST, resource: { area_code: 'siio', assignee_id: 'user-colaborador' }, expected: true },
  { name: 'colaborador falla cerrado sin assignee', profile: human('colaborador'), action: ACTIONS.SIIO_ASSIGNMENT_VIEW, resource: { area_code: 'siio' }, expected: false },
  { name: 'colaborador no aprueba cierre definitivo', profile: human('colaborador'), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio', assignee_id: 'user-colaborador' }, expected: false },
  { name: 'director con área ve asignación interna', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.SIIO_ASSIGNMENT_VIEW, resource: { area_code: 'siio' }, expected: true },
  { name: 'director no aprueba cierre definitivo', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio' }, expected: false },
  { name: 'gerencia aprueba cierre definitivo', profile: human('gerencia'), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio' }, expected: true },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

runCases('junta, agentes y fallos cerrados', [
  { name: 'junta ve publicación aprobada', profile: human('junta'), action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: { publication_status: 'published' }, expected: true },
  { name: 'junta no ve borrador', profile: human('junta'), action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: { publication_status: 'draft' }, expected: false },
  { name: 'junta falla cerrado sin estado', profile: human('junta'), action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: {}, expected: false },
  { name: 'junta no edita borrador', profile: human('junta'), action: ACTIONS.BOARD_DRAFT_EDIT, resource: {}, expected: false },
  { name: 'gerencia publica', profile: human('gerencia'), action: ACTIONS.BOARD_PUBLISH, resource: {}, expected: true },
  { name: 'agent técnico ejecuta análisis', profile: agent(), action: ACTIONS.AI_ANALYSIS_RUN, resource: { technical_authorized: true }, expected: true },
  { name: 'agent falla sin autorización técnica', profile: agent(), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'agent con role falso admin no publica', profile: agent(), action: ACTIONS.BOARD_PUBLISH, resource: {}, expected: false },
  { name: 'agent con role falso admin no aprueba junta', profile: agent(), action: ACTIONS.BOARD_APPROVE, resource: {}, expected: false },
  { name: 'agent con role falso admin no aprueba cierre', profile: agent(), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio' }, expected: false },
  { name: 'acción desconocida', profile: human('admin'), action: 'UNKNOWN_ACTION', resource: {}, expected: false },
  { name: 'perfil malformado', profile: { id: 'bad', active: true, role: 'desconocido', areas: [], permissions: [] }, action: ACTIONS.USERS_MANAGE, resource: {}, expected: false },
  { name: 'resource no objeto falla cerrado cuando necesita campos', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, resource: null, expected: false },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

const sensitiveResource = { area_code: 'siio', assignee_id: 'other', secret: 'no-filtrar', action: 'no-filtrar' };
assert.equal(requireAction(human('admin'), ACTIONS.USERS_MANAGE, {}), true, 'requireAction devuelve true al permitir');
assert.throws(
  () => requireAction(human('colaborador'), ACTIONS.SIIO_CLOSE_APPROVE, sensitiveResource),
  (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);
    assert.doesNotMatch(error.message, /SIIO|other|no-filtrar|secret|action/i);
    return true;
  },
  'requireAction debe negar con error genérico y sin filtraciones',
);

console.log('access control matrix contract passed');
