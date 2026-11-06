// Estudios de Seguridad Física — tipos y llamadas a /api/estudios-seguridad (tramo 1).
// La valoración llega calculada por el servidor; esta capa nunca calcula.
import { api } from '../apiClient';

export type StudyStatus = 'borrador' | 'en_revision' | 'devuelto' | 'revisado' | 'aprobado' | 'archivado';
export type Nivel = 'bajo' | 'moderado' | 'alto' | 'critico';

export type StudySummaryRow = {
  id: string; code: string; title: string; status: StudyStatus; client_name: string; site_name: string;
  site_city: string | null; visit_date: string | null; updated_at: string; risk_count: number;
};

export type Study = StudySummaryRow & {
  client_source: 'avancys' | 'crm'; client_ref: string; client_nit: string | null;
  site_source: 'avancys_puesto' | 'crm' | 'manual'; site_ref: string | null; site_address: string | null;
  scope: string | null; methodology_id: string; template_id: string; prepared_by: string;
  client_description?: string | null; location_description?: string | null; latitude?: number | string | null; longitude?: number | string | null;
  external_context?: string | null; criminal_groups?: string | null; internal_context?: string | null;
  context_sources?: Array<{ nombre: string; url: string | null; fecha: string | null }>;
};

export type Zone = { id: string; name: string; description: string | null; position: number };

type Tramo = { probabilidad: number; efectividadControl: number; magnitud: number; nivel: Nivel };
export type Valuation = { impacto: number; inherente: { magnitud: number; nivel: Nivel }; actual: Tramo; residual: Tramo };

export type Risk = {
  id: string; number: number; zone_id: string | null; catalog_risk_code: string | null; process_code: string | null;
  title: string; client_process?: string | null; risk_factor?: string | null; causes: string | null; consequences: string | null;
  probability: number; impact_company: number; impact_people: number;
  current_control: string | null; current_quality: number | null; current_efficacy: number | null; current_efficiency: number | null;
  proposed_control: string | null; proposed_quality: number | null; proposed_efficacy: number | null; proposed_efficiency: number | null;
  origin: 'manual' | 'agente'; valuation: Valuation;
};

export type Action = {
  id: string; risk_id: string; description: string; owner_label: string | null; due_date: string | null;
  priority: 'alta' | 'media' | 'baja'; status: 'pendiente' | 'en_curso' | 'cumplida' | 'descartada';
};

export type Evidence = {
  id: string; zone_id: string | null; risk_id: string | null; purpose?: 'evidencia' | 'mapa' | 'logo'; kind: 'foto' | 'documento'; file_name: string; mime_type: string;
  size_bytes: number; sha256: string; caption: string | null; taken_on: string | null; created_at: string;
};

export type WorkflowAction = 'enviar' | 'marcar_revisado' | 'devolver' | 'aprobar' | 'reabrir';
export type Workflow = {
  available: boolean;
  can: Partial<Record<WorkflowAction, boolean>>;
  names: Record<string, string>;
  followups?: { total: number; abiertos: number; cumplidos: number } | null;
  events: Array<{ id: string; action: WorkflowAction; from_status: StudyStatus; to_status: StudyStatus; note: string | null; version: number | null; actor_id: string; created_at: string }>;
  versions: Array<{
    id: string; version: number; methodology_id: string; snapshot_sha256: string; approved_by: string; approved_at: string;
    archive: { status: 'pendiente' | 'procesando' | 'archivado' | 'fallido'; report_url: string | null; error: string | null; finished_at: string | null; files: Array<{ nombre: string; tipo: string; url: string | null }> } | null;
  }>;
};

export type CrimeStat = { id: string; crime: string; count: number; source: string; cutoff_date: string | null };
export type Contact = { id: string; kind: 'apoyo' | 'empresa' | 'interventor'; entity: string; detail: string | null; phone: string | null; email: string | null };
export type Post = { id: string; source: 'avancys' | 'manual'; source_ref: string | null; name: string; modality: 'vigilancia' | 'guia_canino' | 'supervision' | 'monitoreo' | 'otro'; schedule: string | null; armed: boolean | null; quantity: number };
export type Characterization = { available: boolean; estadisticas: CrimeStat[]; contactos: Contact[]; dispositivo: Post[] };
export type CharacterizationSection = 'estadisticas' | 'contactos' | 'dispositivo';

export type Catalog = { procesos: Array<{ codigo: string; nombre: string }>; riesgos: Array<{ codigo: string; nombre: string; procesos: string[] }> };

export type StudyDetail = {
  study: Study; zones: Zone[]; risks: Risk[]; actions: Action[]; editable: boolean; catalog: Catalog | null;
  evidence: Evidence[]; evidence_available: boolean; workflow?: Workflow; characterization?: Characterization;
  summary: { risks: number; levels: { actual: Partial<Record<Nivel, number>>; residual: Partial<Record<Nivel, number>> } };
};

export type ClientOption = { source: 'avancys' | 'crm'; ref: string; name: string; nit: string | null; city: string | null; site: string | null };
export type PostsResult = { encontrado: boolean; avancys: string; contratos: Array<{ nombre: string | null; inicia: string | null; vence: string | null; total_puestos: number; puestos: Array<{ codigo: string | null; nombre: string | null }> }> };

export type RiskDraft = Partial<Omit<Risk, 'id' | 'number' | 'valuation' | 'origin'>>;
export type ActionDraft = Partial<Omit<Action, 'id'>> & { risk_id: string };

const BASE = '/api/estudios-seguridad';
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listStudies = () => api<{ studies: StudySummaryRow[] }>(BASE);
export const getStudy = (id: string) => api<StudyDetail>(`${BASE}/${encodeURIComponent(id)}`);
export const createStudy = (body: Record<string, unknown>) => api<Study>(BASE, json('POST', body));
export const updateStudy = (id: string, body: Record<string, unknown>) => api<Study>(`${BASE}/${encodeURIComponent(id)}`, json('PATCH', body));
export const searchClients = (q: string) => api<{ clients: ClientOption[]; avancys: string }>(`${BASE}/clientes?q=${encodeURIComponent(q)}`);
export const clientPosts = (nit: string) => api<PostsResult>(`${BASE}/puestos?nit=${encodeURIComponent(nit)}`);

const child = (studyId: string, kind: 'zonas' | 'riesgos' | 'acciones', childId?: string) =>
  `${BASE}/${encodeURIComponent(studyId)}/${kind}${childId ? `/${encodeURIComponent(childId)}` : ''}`;
export const addZone = (studyId: string, body: { name: string; description?: string }) => api<Zone>(child(studyId, 'zonas'), json('POST', body));
export const deleteZone = (studyId: string, zoneId: string) => api(child(studyId, 'zonas', zoneId), { method: 'DELETE' });
export const addRisk = (studyId: string, body: RiskDraft) => api<Risk>(child(studyId, 'riesgos'), json('POST', body));
export const updateRisk = (studyId: string, riskId: string, body: RiskDraft) => api<Risk>(child(studyId, 'riesgos', riskId), json('PATCH', body));
export const deleteRisk = (studyId: string, riskId: string) => api(child(studyId, 'riesgos', riskId), { method: 'DELETE' });
export const addAction = (studyId: string, body: ActionDraft) => api<Action>(child(studyId, 'acciones'), json('POST', body));
export const updateAction = (studyId: string, actionId: string, body: Partial<Action>) => api<Action>(child(studyId, 'acciones', actionId), json('PATCH', body));
export const deleteAction = (studyId: string, actionId: string) => api(child(studyId, 'acciones', actionId), { method: 'DELETE' });

// Evidencias: el servidor da el permiso firmado, el navegador sube directo al depósito y el servidor verifica.
export const requestEvidenceUpload = (studyId: string, body: { file_name: string; mime_type: string; size_bytes: number; risk_id?: string | null; zone_id?: string | null; purpose?: 'evidencia' | 'mapa' | 'logo' }) =>
  api<{ bucket: string; path: string; token: string }>(`${BASE}/${encodeURIComponent(studyId)}/evidencias/upload-url`, json('POST', body));
export const completeEvidenceUpload = (studyId: string, body: { path: string; file_name: string; risk_id?: string | null; zone_id?: string | null; caption?: string | null; taken_on?: string | null; purpose?: 'evidencia' | 'mapa' | 'logo' }) =>
  api<Evidence>(`${BASE}/${encodeURIComponent(studyId)}/evidencias`, json('POST', body));
export const evidenceUrls = (studyId: string) => api<{ urls: Record<string, string | null>; expires_in: number }>(`${BASE}/${encodeURIComponent(studyId)}/evidencias/urls`);
export const deleteEvidence = (studyId: string, evidenceId: string) => api(`${BASE}/${encodeURIComponent(studyId)}/evidencias/${encodeURIComponent(evidenceId)}`, { method: 'DELETE' });

export const transitionStudy = (studyId: string, action: WorkflowAction, note?: string) =>
  api<{ status: StudyStatus; version: number | null; sha256: string | null }>(`${BASE}/${encodeURIComponent(studyId)}/flujo`, json('POST', { action, note: note || null }));

export const ACTION_LABELS: Record<WorkflowAction, string> = {
  enviar: 'Enviado a revisión', marcar_revisado: 'Revisado', devolver: 'Devuelto con observaciones', aprobar: 'Aprobado', reabrir: 'Reabierto',
};

// Nota de campo con Vig-IA: propone (no guarda) y la persona confirma con su calificación.
export type FieldNoteRisk = {
  zone_id: string | null; zone_ref: string | null; catalog_risk_code: string | null; process_code: string | null; title: string;
  causes: string | null; consequences: string | null; current_control: string | null; proposed_control: string | null; evidence_quote: string;
};
export type FieldNoteProposal = { respuesta: string; zonas_nuevas: Array<{ ref: string; nombre: string }>; riesgos: FieldNoteRisk[]; avisos: string[] };
export const proposeFromNote = (studyId: string, nota: string) => api<FieldNoteProposal>(`${BASE}/${encodeURIComponent(studyId)}/agente/proponer`, json('POST', { nota }));
export const confirmFromNote = (studyId: string, body: { zonas_nuevas: Array<{ ref: string; nombre: string }>; riesgos: Array<FieldNoteRisk & { probability: number; impact_company: number; impact_people: number }> }) =>
  api<{ zonas: Zone[]; riesgos: Risk[] }>(`${BASE}/${encodeURIComponent(studyId)}/agente/confirmar`, json('POST', body));

// Caracterización de la sede (tramo 5).
export const addCharacterizationRow = (studyId: string, section: CharacterizationSection, body: Record<string, unknown>) =>
  api(`${BASE}/${encodeURIComponent(studyId)}/${section}`, json('POST', body));
export const deleteCharacterizationRow = (studyId: string, section: CharacterizationSection, rowId: string) =>
  api(`${BASE}/${encodeURIComponent(studyId)}/${section}/${encodeURIComponent(rowId)}`, { method: 'DELETE' });
export const seedPostsFromAvancys = (studyId: string) =>
  api<{ added: number; already: number; found: number }>(`${BASE}/${encodeURIComponent(studyId)}/dispositivo-desde-avancys`, { method: 'POST' });

export const STATUS_LABELS: Record<StudyStatus, string> = {
  borrador: 'Borrador', en_revision: 'En revisión', devuelto: 'Devuelto', revisado: 'Revisado', aprobado: 'Aprobado', archivado: 'Archivado',
};
export const NIVEL_LABELS: Record<Nivel, string> = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico' };
export const NIVEL_ORDER: Nivel[] = ['critico', 'alto', 'moderado', 'bajo'];

// Escalas con los nombres que la casa usa con sus clientes (informe de HADA, 2026-11-05); los números no cambian.
// Copia de ESCALAS en verticales/estudios-seguridad/plantilla.js (el servidor es el que manda).
export const PROBABILITY_SCALE = ['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta'];
export const IMPACT_SCALE = ['Insignificante', 'Leve', 'Moderado', 'Grave', 'Catastrófico'];
// Calificación del control en palabras, verificada contra los Excel (2 = Poco, 3 = Medianamente, 4 = pleno). Para 1 y
// 5 no hay ejemplo en ningún estudio: se muestra el número.
const CONTROL_WORDS: Record<'calidad' | 'eficacia' | 'eficiencia', Record<number, string>> = {
  calidad: { 2: 'Poco confiable', 3: 'Medianamente confiable', 4: 'Confiable' },
  eficacia: { 2: 'Poco eficaz', 3: 'Medianamente eficaz', 4: 'Eficaz' },
  eficiencia: { 2: 'Poco eficiente', 3: 'Medianamente eficiente', 4: 'Eficiente' },
};
export const controlScale = (dimension: 'calidad' | 'eficacia' | 'eficiencia') => [1, 2, 3, 4, 5].map(value => CONTROL_WORDS[dimension][value] || String(value));
