// Estudios de Seguridad Física, tramo 3 — revisión, aprobación y versión congelada (Juan, 2026-11-05).
//
// Preparador → revisor técnico → aprobador. El servidor decide quién puede pedir cada paso y qué tiene que estar
// completo; la función psi_security_study_transition (migración 180) hace el cambio de estado, la bitácora y la
// versión en una sola transacción, y vuelve a negar que quien preparó el estudio lo revise o lo apruebe.
//
// La IA no participa aquí: ni aprueba ni cierra riesgos (decisión de Juan). Cada paso lo da una persona con su permiso.

import { createHash } from 'node:crypto';
import { getStudy } from './estudios.js';

export const REVIEW_PERMISSION = 'estudios_seguridad_revisar';
export const APPROVE_PERMISSION = 'estudios_seguridad_aprobar';
export const EVENTS_TABLE = 'psi_security_study_events';
export const VERSIONS_TABLE = 'psi_security_study_versions';
export const ACTIONS = Object.freeze(['enviar', 'marcar_revisado', 'devolver', 'aprobar', 'reabrir']);
const CRITICAL_LEVELS = new Set(['alto', 'critico']);

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const holds = (profile, code) => Array.isArray(profile?.permissions) && profile.permissions.includes(code);

// Qué puede hacer esta persona con este estudio ahora. Lo usa la pantalla para mostrar botones y el servidor para
// rechazar; la base lo vuelve a comprobar.
export function workflowPermissions(profile, study) {
  const preparer = profile?.id === study.prepared_by;
  const reviewer = holds(profile, REVIEW_PERMISSION) && !preparer;
  const approver = holds(profile, APPROVE_PERMISSION) && !preparer;
  return {
    enviar: ['borrador', 'devuelto'].includes(study.status),
    marcar_revisado: study.status === 'en_revision' && reviewer,
    devolver: (study.status === 'en_revision' && reviewer) || (study.status === 'revisado' && (reviewer || approver)),
    aprobar: study.status === 'revisado' && approver,
    reabrir: study.status === 'aprobado' && holds(profile, APPROVE_PERMISSION),
  };
}

// Lo que falta para que un estudio se pueda enviar o aprobar. Lista vacía = listo.
export function readinessIssues(detail) {
  const issues = [];
  if (!detail.study.scope || !detail.study.scope.trim()) issues.push('Falta el alcance del estudio.');
  if (!detail.study.visit_date) issues.push('Falta la fecha de la visita.');
  if (detail.risks.length === 0) issues.push('El estudio no tiene riesgos.');
  for (const risk of detail.risks) {
    if (!CRITICAL_LEVELS.has(risk.valuation.actual.nivel)) continue;
    const planned = detail.actions.some(action => action.risk_id === risk.id && action.status !== 'descartada' && action.owner_label && action.due_date);
    if (!planned) issues.push(`R${risk.number} está en nivel ${risk.valuation.actual.nivel === 'critico' ? 'crítico' : 'alto'} y no tiene una acción con responsable y fecha.`);
  }
  return issues;
}

// JSON con las llaves ordenadas: la misma foto da siempre la misma huella.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

// La foto de la versión: lo que el informe y el archivo van a mostrar. Las evidencias van por su huella, no por bytes.
export function buildSnapshot(detail) {
  const { study } = detail;
  const snapshot = {
    estudio: {
      id: study.id, codigo: study.code, titulo: study.title, plantilla: study.template_id, metodologia: study.methodology_id,
      cliente: { fuente: study.client_source, referencia: study.client_ref, nombre: study.client_name, nit: study.client_nit },
      sede: { fuente: study.site_source, referencia: study.site_ref, nombre: study.site_name, ciudad: study.site_city, direccion: study.site_address },
      alcance: study.scope, fecha_visita: study.visit_date, preparado_por: study.prepared_by,
    },
    zonas: detail.zones.map(zone => ({ id: zone.id, nombre: zone.name, descripcion: zone.description, orden: zone.position })),
    riesgos: detail.risks.map(risk => ({
      id: risk.id, numero: risk.number, zona: risk.zone_id, catalogo: risk.catalog_risk_code, proceso: risk.process_code,
      riesgo: risk.title, causas: risk.causes, consecuencias: risk.consequences,
      probabilidad: risk.probability, impacto_empresa: risk.impact_company, impacto_personas: risk.impact_people,
      control_existente: { descripcion: risk.current_control, calidad: risk.current_quality, eficacia: risk.current_efficacy, eficiencia: risk.current_efficiency },
      control_propuesto: { descripcion: risk.proposed_control, calidad: risk.proposed_quality, eficacia: risk.proposed_efficacy, eficiencia: risk.proposed_efficiency },
      origen: risk.origin, valoracion: risk.valuation,
    })),
    acciones: detail.actions.map(action => ({
      id: action.id, riesgo: action.risk_id, accion: action.description, responsable: action.owner_label,
      fecha_compromiso: action.due_date, prioridad: action.priority, estado: action.status,
    })),
    evidencias: (detail.evidence || []).map(item => ({
      id: item.id, riesgo: item.risk_id, zona: item.zone_id, tipo: item.kind, archivo: item.file_name, mime: item.mime_type,
      bytes: item.size_bytes, sha256: item.sha256, ruta: item.storage_path, leyenda: item.caption, fecha: item.taken_on,
    })),
  };
  // La huella se calcula sobre exactamente lo que se guarda en jsonb: fechas como texto, sin `undefined`.
  const stored = JSON.parse(JSON.stringify(snapshot));
  return { snapshot: stored, sha256: createHash('sha256').update(canonicalJson(stored)).digest('hex') };
}

const TRANSITION_ERRORS = [
  [/TRANSICION_INVALIDA/, 'El estudio cambió de estado mientras tanto. Recargue la página.', 409],
  [/PREPARADOR_NO_PUEDE/, 'Quien preparó el estudio no puede revisarlo ni aprobarlo.', 403],
  [/DEVOLVER_SIN_OBSERVACION/, 'Para devolver el estudio escriba la observación.', 400],
  [/ESTUDIO_NO_ENCONTRADO/, 'Estudio no encontrado.', 404],
];

export async function transitionStudy(db, studyId, body = {}, profile) {
  const action = ACTIONS.includes(body.action) ? body.action : null;
  if (!action) throw invalid('Acción no válida.');
  const detail = await getStudy(db, studyId);
  if (!workflowPermissions(profile, detail.study)[action]) {
    throw invalid(profile?.id === detail.study.prepared_by && ['marcar_revisado', 'devolver', 'aprobar'].includes(action)
      ? 'Quien preparó el estudio no puede revisarlo ni aprobarlo.'
      : 'Su perfil no puede hacer este paso con el estudio en su estado actual.', 403);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : '';
  if (action === 'devolver' && note.length < 3) throw invalid('Para devolver el estudio escriba la observación.');
  if (action === 'enviar' || action === 'aprobar') {
    const issues = readinessIssues(detail);
    if (issues.length) {
      const error = invalid(`Antes de ${action === 'enviar' ? 'enviar' : 'aprobar'}: ${issues.join(' ')}`, 422);
      error.issues = issues;
      throw error;
    }
  }
  const version = action === 'aprobar' ? buildSnapshot(detail) : null;
  const { data, error } = await db.rpc('psi_security_study_transition', {
    p_study_id: detail.study.id, p_action: action, p_actor_id: profile.id, p_note: note || null,
    p_snapshot: version?.snapshot ?? null, p_snapshot_sha256: version?.sha256 ?? null,
  });
  if (error) {
    const known = TRANSITION_ERRORS.find(([pattern]) => pattern.test(error.message || ''));
    if (known) throw invalid(known[1], known[2]);
    throw error;
  }
  return { ...data, sha256: version?.sha256 ?? null };
}

const missingTable = error => error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''));

// Bitácora, versiones y botones para la ficha. Sin la migración 180, la ficha se sigue viendo sin el flujo.
export async function loadWorkflow(db, study, profile) {
  const [events, versions] = await Promise.all([
    db.from(EVENTS_TABLE).select('id, action, from_status, to_status, note, version, actor_id, created_at').eq('study_id', study.id).order('created_at', { ascending: true }),
    db.from(VERSIONS_TABLE).select('id, version, methodology_id, snapshot_sha256, approved_by, approved_at').eq('study_id', study.id).order('version', { ascending: true }),
  ]);
  if (missingTable(events.error) || missingTable(versions.error)) return { available: false, events: [], versions: [], can: {}, names: {} };
  if (events.error) throw events.error;
  if (versions.error) throw versions.error;
  const ids = [...new Set([...(events.data || []).map(item => item.actor_id), ...(versions.data || []).map(item => item.approved_by), study.prepared_by])];
  const { data: people } = await db.from('psi_sales_profiles').select('id, full_name').in('id', ids);
  return {
    available: true,
    events: events.data || [],
    versions: versions.data || [],
    can: workflowPermissions(profile, study),
    names: Object.fromEntries((people || []).map(person => [person.id, person.full_name])),
  };
}
