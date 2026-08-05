import { strict as assert } from 'node:assert';
import {
  ACTIONS,
  can,
  hasAreaScope,
  hasPermission,
  requireAction,
} from '../access-control.js';
import { MODULE_PERMISSION_CODES } from '../module-access.js';

const profile = (role, overrides = {}) => ({
  id: `user-${role}`,
  role,
  active: true,
  areas: [],
  permissions: [],
  ...overrides,
});

const human = (role, overrides = {}) => profile(role, { identity_type: 'human', ...overrides });
const agent = (overrides = {}) => ({
  id: 'agent-1',
  active: true,
  identity_type: 'agent',
  areas: [],
  permissions: [],
  ...overrides,
});
const commercialDirector = (areas, overrides = {}) => human('director', { areas, ...overrides });
const tenderUser = (role, overrides = {}) => human(role, { permissions: ['licitaciones'], ...overrides });

const runCases = (label, cases, fn) => {
  for (const scenario of cases) {
    assert.equal(fn(scenario), scenario.expected, `${label}: ${scenario.name}`);
  }
};

assert.equal(Object.isFrozen(ACTIONS), true, 'ACTIONS debe estar congelado');
const actionValues = Object.values(ACTIONS);
assert.deepEqual(ACTIONS, {
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
}, 'ACTIONS debe coincidir exactamente con el contrato estable de 40 acciones');
assert.equal(actionValues.length, 40, 'ACTIONS debe exponer exactamente 40 códigos estables');
assert.equal(new Set(actionValues).size, actionValues.length, 'todos los códigos de acción deben ser únicos');
assert.ok(actionValues.every((value) => typeof value === 'string' && value.length > 0), 'todos los códigos de acción deben ser strings no vacíos');
const originalUsersManageAction = ACTIONS.USERS_MANAGE;
try {
  ACTIONS.USERS_MANAGE = 'forged';
} catch {
  // ESM strict mode may throw when mutating the frozen action contract.
}
assert.equal(ACTIONS.USERS_MANAGE, originalUsersManageAction, 'ACTIONS no puede mutarse');

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

runCases('entrada explícita a módulos', [
  { name: 'admin sin módulo Usuarios no entra', profile: human('admin', { permissions: [] }), action: ACTIONS.MODULE_USERS_VIEW, expected: false },
  { name: 'admin con módulo Usuarios entra', profile: human('admin', { permissions: ['modulo_usuarios'] }), action: ACTIONS.MODULE_USERS_VIEW, expected: true },
  { name: 'admin con SIIO entra', profile: human('admin', { permissions: ['modulo_siio_gerencial'] }), action: ACTIONS.MODULE_SIIO_VIEW, expected: true },
  { name: 'director con Vig-IA entra', profile: human('director', { permissions: ['modulo_vig_ia'] }), action: ACTIONS.MODULE_VIGIA_VIEW, expected: true },
  { name: 'gerencia con Dashboard entra', profile: human('gerencia', { permissions: ['modulo_dashboard_comercial'] }), action: ACTIONS.MODULE_DASHBOARD_VIEW, expected: true },
  { name: 'comercial con Alertas entra', profile: human('comercial', { permissions: ['modulo_alertas_comerciales'] }), action: ACTIONS.MODULE_ALERTS_VIEW, expected: true },
  { name: 'comercial con Oportunidades entra', profile: human('comercial', { permissions: ['modulo_oportunidades'] }), action: ACTIONS.MODULE_OPPORTUNITIES_VIEW, expected: true },
  { name: 'colaborador con Metas entra', profile: human('colaborador', { permissions: ['modulo_metas'] }), action: ACTIONS.MODULE_GOALS_VIEW, expected: true },
  { name: 'comercial con SIIO incompatible no entra', profile: human('comercial', { permissions: ['modulo_siio_gerencial'] }), action: ACTIONS.MODULE_SIIO_VIEW, expected: false },
  { name: 'junta con Dashboard incompatible no entra', profile: human('junta', { permissions: ['modulo_dashboard_comercial'] }), action: ACTIONS.MODULE_DASHBOARD_VIEW, expected: false },
  { name: 'admin inactivo no entra aunque tenga módulos', profile: human('admin', { active: false, permissions: MODULE_PERMISSION_CODES }), action: ACTIONS.MODULE_DASHBOARD_VIEW, expected: false },
], ({ profile: candidate, action }) => can(candidate, action));

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

runCases('Vig-IA borrador comercial', [
  { name: 'comercial con ambos módulos ejecuta sobre oportunidad propia', profile: human('comercial', { permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'] }), resource: ownOpportunity, expected: true },
  { name: 'admin con módulos pero sin permiso piloto falla cerrado', profile: human('admin', { permissions: ['modulo_vig_ia', 'modulo_oportunidades'] }), resource: ownOpportunity, expected: false },
  { name: 'gerencia con módulos y permiso piloto ejecuta', profile: human('gerencia', { permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'] }), resource: ownOpportunity, expected: true },
  { name: 'comercial sin Vig-IA falla cerrado', profile: human('comercial', { permissions: ['modulo_oportunidades'] }), resource: ownOpportunity, expected: false },
  { name: 'comercial sin Oportunidades falla cerrado', profile: human('comercial', { permissions: ['modulo_vig_ia'] }), resource: ownOpportunity, expected: false },
  { name: 'comercial con ambos módulos no ejecuta sobre oportunidad ajena', profile: human('comercial', { permissions: ['modulo_vig_ia', 'modulo_oportunidades'] }), resource: { ...ownOpportunity, owner_id: 'other' }, expected: false },
  { name: 'director con ambos módulos y scope ejecuta', profile: commercialDirector([{ area_code: 'comercial', subarea_code: 'norte' }], { permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'] }), resource: ownOpportunity, expected: true },
  { name: 'director con ambos módulos fuera de scope falla', profile: commercialDirector([{ area_code: 'comercial', subarea_code: 'sur' }], { permissions: ['modulo_vig_ia', 'modulo_oportunidades'] }), resource: ownOpportunity, expected: false },
  { name: 'gerencia con ambos módulos ejecuta', profile: human('gerencia', { permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'] }), resource: ownOpportunity, expected: true },
  { name: 'agente no puede ejecutar aunque aparente módulos y scope', profile: agent({ permissions: ['modulo_vig_ia', 'modulo_oportunidades'] }), resource: ownOpportunity, expected: false },
], ({ profile: candidate, resource }) => can(candidate, ACTIONS.AI_COMMERCIAL_DRAFT_RUN, resource));

runCases('licitaciones', [
  { name: 'admin sin permiso no consulta', profile: human('admin'), action: ACTIONS.LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'operador de licitaciones usa la Mesa', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_WORKBENCH_USE, resource: {}, expected: true },
  { name: 'colaborador no usa la Mesa aunque aparente permiso', profile: tenderUser('colaborador'), action: ACTIONS.LICITACIONES_WORKBENCH_USE, resource: {}, expected: false },
  { name: 'encargada comercial con custodia revisa documentos y aprendizaje', profile: tenderUser('comercial', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.LICITACIONES_WORKBENCH_CUSTODY, resource: {}, expected: true },
  { name: 'operador sin custodia no revisa documentos ni aprendizaje', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_WORKBENCH_CUSTODY, resource: {}, expected: false },
  { name: 'custodia comercial no recibe autoridad go-no-go', profile: tenderUser('comercial', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: {}, expected: false },
  { name: 'agente no puede usar ni custodiar la Mesa', profile: agent(), action: ACTIONS.LICITACIONES_WORKBENCH_USE, resource: { technical_authorized: true }, expected: false },
  { name: 'gerencia con permiso sincroniza', profile: tenderUser('gerencia'), action: ACTIONS.LICITACIONES_SYNC, resource: {}, expected: true },
  { name: 'director con permiso propone descarte', profile: tenderUser('director'), action: ACTIONS.LICITACIONES_DISCARD_PROPOSE, resource: {}, expected: true },
  { name: 'comercial con permiso recomienda go-no-go', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND, resource: {}, expected: true },
  { name: 'admin sin custodia no configura', profile: tenderUser('admin'), action: ACTIONS.LICITACIONES_CONFIGURE, resource: {}, expected: false },
  { name: 'gerencia sin custodia no configura', profile: tenderUser('gerencia'), action: ACTIONS.LICITACIONES_CONFIGURE, resource: {}, expected: false },
  { name: 'director con custodia configura', profile: tenderUser('director', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.LICITACIONES_CONFIGURE, resource: {}, expected: true },
  { name: 'comercial con permiso no configura', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_CONFIGURE, resource: {}, expected: false },
  { name: 'Katherine mantiene ficha empresarial con permiso dedicado', profile: tenderUser('comercial', { permissions: ['licitaciones', 'licitaciones_empresa'] }), action: ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE, resource: {}, expected: true },
  { name: 'custodia conserva mantenimiento de ficha empresarial', profile: tenderUser('director', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE, resource: {}, expected: true },
  { name: 'permiso empresarial sin licitaciones falla cerrado', profile: human('comercial', { permissions: ['licitaciones_empresa'] }), action: ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE, resource: {}, expected: false },
  { name: 'permiso empresarial no concede custodia', profile: tenderUser('comercial', { permissions: ['licitaciones', 'licitaciones_empresa'] }), action: ACTIONS.LICITACIONES_CONFIGURE, resource: {}, expected: false },
  { name: 'agente con permiso empresarial no edita ficha', profile: agent({ permissions: ['licitaciones', 'licitaciones_empresa'] }), action: ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE, resource: {}, expected: false },
  { name: 'director sin permiso no configura', profile: human('director'), action: ACTIONS.LICITACIONES_CONFIGURE, resource: {}, expected: false },
  { name: 'admin sin custodia no convierte', profile: tenderUser('admin'), action: ACTIONS.LICITACIONES_CONVERT, resource: {}, expected: false },
  { name: 'encargada con custodia convierte', profile: tenderUser('director', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.LICITACIONES_CONVERT, resource: {}, expected: true },
  { name: 'comercial con permiso no aprueba descarte', profile: tenderUser('comercial'), action: ACTIONS.LICITACIONES_DISCARD_APPROVE, resource: {}, expected: false },
  { name: 'director con permiso aprueba go-no-go', profile: tenderUser('director'), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: {}, expected: true },
  { name: 'director sin permiso no aprueba', profile: human('director'), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: {}, expected: false },
  { name: 'no existe fallback por correo', profile: human('admin', { microsoft_email: 'directora.licitaciones@seguridadnacional.co' }), action: ACTIONS.LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'colaborador con permiso sigue denegado', profile: tenderUser('colaborador'), action: ACTIONS.LICITACIONES_VIEW, resource: {}, expected: false },
  { name: 'agent técnico puede recomendar', profile: agent(), action: ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND, resource: { technical_authorized: true }, expected: true },
  { name: 'agent técnico no recomienda sin autorización técnica', profile: agent(), action: ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND, resource: {}, expected: false },
  { name: 'agent técnico no aprueba', profile: agent(), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: { technical_authorized: true }, expected: false },
  // AGT-002: gastar cupo de AI_ANALYSIS_RUN exige custodia explícita de
  // licitaciones (licitaciones + licitaciones_custodia). El rol por sí solo
  // nunca alcanza y GO/NO GO permanece como una decisión humana separada.
  { name: 'comercial con custodia ejecuta análisis IA', profile: tenderUser('comercial', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: true },
  { name: 'admin con custodia ejecuta análisis IA', profile: tenderUser('admin', { permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: true },
  { name: 'admin solo con licitaciones no ejecuta análisis IA', profile: tenderUser('admin'), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'gerencia solo con licitaciones no ejecuta análisis IA', profile: tenderUser('gerencia'), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'director solo con licitaciones no ejecuta análisis IA', profile: tenderUser('director'), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'comercial solo con licitaciones no ejecuta análisis IA', profile: tenderUser('comercial'), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'comercial con custodia sin licitaciones no ejecuta análisis IA', profile: human('comercial', { permissions: ['licitaciones_custodia'] }), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'director sin permiso de licitaciones no ejecuta análisis IA', profile: human('director'), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'colaborador solo con licitaciones no ejecuta análisis IA', profile: tenderUser('colaborador'), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'comercial con custodia pero inactivo falla cerrado', profile: tenderUser('comercial', { active: false, permissions: ['licitaciones', 'licitaciones_custodia'] }), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
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
  { name: 'director con área ve asignación interna', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.SIIO_ASSIGNMENT_VIEW, resource: { area_code: 'siio', assignee_id: 'other' }, expected: true },
  { name: 'director no aprueba cierre definitivo', profile: commercialDirector([{ area_code: 'siio', subarea_code: null }]), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio' }, expected: false },
  { name: 'gerencia aprueba cierre definitivo', profile: human('gerencia'), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio', assignee_id: 'other' }, expected: true },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

runCases('junta, agentes y fallos cerrados', [
  { name: 'junta ve publicación aprobada', profile: human('junta'), action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: { publication_status: 'published' }, expected: true },
  { name: 'junta no ve borrador', profile: human('junta'), action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: { publication_status: 'draft' }, expected: false },
  { name: 'junta falla cerrado sin estado', profile: human('junta'), action: ACTIONS.BOARD_PUBLICATION_VIEW, resource: {}, expected: false },
  { name: 'junta no edita borrador', profile: human('junta'), action: ACTIONS.BOARD_DRAFT_EDIT, resource: {}, expected: false },
  { name: 'gerencia publica', profile: human('gerencia'), action: ACTIONS.BOARD_PUBLISH, resource: {}, expected: true },
  { name: 'agent técnico ejecuta análisis', profile: agent(), action: ACTIONS.AI_ANALYSIS_RUN, resource: { technical_authorized: true }, expected: true },
  { name: 'agent falla sin autorización técnica', profile: agent(), action: ACTIONS.AI_ANALYSIS_RUN, resource: {}, expected: false },
  { name: 'agent role-less no administra usuarios', profile: agent(), action: ACTIONS.USERS_MANAGE, resource: {}, expected: false },
  { name: 'agent role-less no edita oportunidad CRM', profile: agent(), action: ACTIONS.CRM_OPPORTUNITY_EDIT, resource: ownOpportunity, expected: false },
  { name: 'agent role-less no aprueba go-no-go', profile: agent(), action: ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, resource: { technical_authorized: true }, expected: false },
  { name: 'agent role-less no aprueba cierre', profile: agent(), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio' }, expected: false },
  { name: 'agent role-less no aprueba junta', profile: agent(), action: ACTIONS.BOARD_APPROVE, resource: {}, expected: false },
  { name: 'agent role-less no publica junta', profile: agent(), action: ACTIONS.BOARD_PUBLISH, resource: {}, expected: false },
  { name: 'agent con role falso admin no publica', profile: agent({ role: 'admin' }), action: ACTIONS.BOARD_PUBLISH, resource: {}, expected: false },
  { name: 'agent con role falso admin no aprueba junta', profile: agent({ role: 'admin' }), action: ACTIONS.BOARD_APPROVE, resource: {}, expected: false },
  { name: 'agent con role falso admin no aprueba cierre', profile: agent({ role: 'admin' }), action: ACTIONS.SIIO_CLOSE_APPROVE, resource: { area_code: 'siio' }, expected: false },
  { name: 'agent con id solo espacios falla cerrado', profile: agent({ id: '   ' }), action: ACTIONS.AI_ANALYSIS_RUN, resource: { technical_authorized: true }, expected: false },
  { name: 'acción desconocida', profile: human('admin'), action: 'UNKNOWN_ACTION', resource: {}, expected: false },
  { name: 'perfil malformado', profile: { id: 'bad', active: true, role: 'desconocido', areas: [], permissions: [] }, action: ACTIONS.USERS_MANAGE, resource: {}, expected: false },
  { name: 'resource no objeto falla cerrado cuando necesita campos', profile: human('comercial'), action: ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, resource: null, expected: false },
], ({ profile: candidate, action, resource }) => can(candidate, action, resource));

const crmSensitiveActions = [
  ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW,
  ACTIONS.CRM_OPPORTUNITY_CREATE,
  ACTIONS.CRM_OPPORTUNITY_EDIT,
  ACTIONS.CRM_OPPORTUNITY_REASSIGN,
];
const validCrmResource = { area_code: 'comercial', subarea_code: null, owner_id: 'user-comercial' };
for (const role of ['admin', 'gerencia']) {
  for (const action of crmSensitiveActions) {
    assert.equal(can(human(role), action, {}), false, `${role} niega CRM sensible sin recurso completo`);
    assert.equal(can(human(role), action, validCrmResource), true, `${role} permite CRM sensible con recurso completo`);
  }
}
for (const action of [
  ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW,
  ACTIONS.CRM_OPPORTUNITY_CREATE,
  ACTIONS.CRM_OPPORTUNITY_EDIT,
]) {
  assert.equal(can(human('comercial'), action, { owner_id: 'user-comercial' }), false, `comercial niega ${action} propio sin área`);
}
assert.equal(
  can(commercialDirector([{ area_code: 'comercial', subarea_code: null }]), ACTIONS.CRM_OPPORTUNITY_REASSIGN, validCrmResource),
  true,
  'director solo reasigna CRM dentro de Comercial asignada',
);

const siioSensitiveActions = [
  ACTIONS.SIIO_ASSIGNMENT_VIEW,
  ACTIONS.SIIO_ASSIGNMENT_UPDATE,
  ACTIONS.SIIO_CLOSE_REQUEST,
  ACTIONS.SIIO_CLOSE_APPROVE,
];
const validSiioResource = { area_code: 'siio', subarea_code: null, assignee_id: 'user-colaborador' };
for (const role of ['admin', 'gerencia']) {
  for (const action of siioSensitiveActions) {
    assert.equal(can(human(role), action, {}), false, `${role} niega SIIO sensible sin recurso completo`);
    assert.equal(can(human(role), action, validSiioResource), true, `${role} permite SIIO sensible con recurso completo`);
  }
}
for (const role of ['comercial', 'colaborador']) {
  for (const action of [ACTIONS.SIIO_ASSIGNMENT_VIEW, ACTIONS.SIIO_ASSIGNMENT_UPDATE, ACTIONS.SIIO_CLOSE_REQUEST]) {
    assert.equal(can(human(role), action, { assignee_id: `user-${role}` }), false, `${role} niega ${action} propio sin área`);
  }
}
assert.equal(
  can(commercialDirector([{ area_code: 'siio', subarea_code: null }]), ACTIONS.SIIO_ASSIGNMENT_VIEW, validSiioResource),
  true,
  'director permite asignación SIIO con recurso completo dentro de área',
);

for (const resource of [
  [],
  { area_code: '   ', owner_id: 'user-comercial' },
  { area_code: 'comercial', owner_id: '   ' },
]) {
  assert.equal(can(human('admin'), ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, resource), false, 'CRM niega recurso malformado');
}
for (const resource of [
  [],
  { area_code: '   ', assignee_id: 'user-colaborador' },
  { area_code: 'siio', assignee_id: '   ' },
]) {
  assert.equal(can(human('admin'), ACTIONS.SIIO_ASSIGNMENT_VIEW, resource), false, 'SIIO niega recurso malformado');
}

const inheritedAdmin = Object.create({
  id: 'forged-admin', active: true, identity_type: 'human', role: 'admin', areas: [], permissions: [],
});
assert.equal(can(inheritedAdmin, ACTIONS.USERS_MANAGE, {}), false, 'perfil heredado no concede administración');
const inheritedCrmResource = Object.create({ area_code: 'comercial', owner_id: 'user-comercial' });
assert.equal(can(human('comercial'), ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, inheritedCrmResource), false, 'CRM no acepta campos heredados');
const inheritedAssignment = Object.create({ area_code: 'siio', subarea_code: null });
assert.equal(hasAreaScope(human('director', { areas: [inheritedAssignment] }), 'siio', null), false, 'alcance no acepta asignación con campos heredados');

const inheritedPermissions = [];
Object.setPrototypeOf(inheritedPermissions, Object.assign([], { 0: 'licitaciones' }));
assert.equal(hasPermission(human('comercial', { permissions: inheritedPermissions }), 'licitaciones'), false, 'permiso heredado no concede acceso');
const forgedSomePermissions = ['not-licitaciones'];
forgedSomePermissions.some = () => true;
assert.equal(hasPermission(human('comercial', { permissions: forgedSomePermissions }), 'licitaciones'), false, 'some manipulado no concede permiso');
const forgedFilterAreas = [{ area_code: 'other', subarea_code: null }];
forgedFilterAreas.filter = () => [{ area_code: 'siio', subarea_code: null }];
assert.equal(hasAreaScope(human('director', { areas: forgedFilterAreas }), 'siio', null), false, 'filter manipulado no concede área');
const inheritedAreaElement = [];
Object.setPrototypeOf(inheritedAreaElement, Object.assign([], { 0: { area_code: 'siio', subarea_code: null } }));
inheritedAreaElement.length = 1;
assert.equal(hasAreaScope(human('director', { areas: inheritedAreaElement }), 'siio', null), false, 'elemento heredado de array no concede área');

const inheritedTechnicalAuthorization = Object.create({ technical_authorized: true });
assert.equal(can(agent(), ACTIONS.AI_ANALYSIS_RUN, inheritedTechnicalAuthorization), false, 'autorización técnica heredada no concede acción de agente');

assert.equal(can(human('admin', { identity_type: 'unknown' }), ACTIONS.USERS_MANAGE, {}), false, 'identity_type desconocido niega admin');
assert.equal(can(profile('admin'), ACTIONS.USERS_MANAGE, {}), true, 'identity_type ausente mantiene compatibilidad legacy');
assert.equal(can(human('admin', { identity_type: null }), ACTIONS.USERS_MANAGE, {}), true, 'identity_type null mantiene compatibilidad humana legacy');
assert.equal(can(human('admin', { identity_type: 'agent' }), ACTIONS.USERS_MANAGE, {}), false, 'identity_type agent permanece bloqueado para acciones humanas');
assert.equal(can(human('admin', { active: false }), ACTIONS.USERS_MANAGE, {}), false, 'identidad inactiva niega admin');
assert.equal(can(human('admin', { id: '   ' }), ACTIONS.USERS_MANAGE, {}), false, 'id con espacios niega admin');

const nullPrototypeAdmin = Object.assign(Object.create(null), {
  id: 'null-admin', active: true, identity_type: 'human', role: 'admin', areas: [], permissions: [],
});
const nullPrototypeCrm = Object.assign(Object.create(null), {
  area_code: 'comercial', subarea_code: null, owner_id: 'null-commercial',
});
const nullPrototypeCommercial = Object.assign(Object.create(null), {
  id: 'null-commercial', active: true, identity_type: 'human', role: 'comercial', areas: [], permissions: [],
});
assert.equal(can(nullPrototypeAdmin, ACTIONS.USERS_MANAGE, {}), true, 'perfil null-prototype con campos propios es válido');
assert.equal(can(nullPrototypeCommercial, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, nullPrototypeCrm), true, 'recurso null-prototype con campos propios es válido');

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
