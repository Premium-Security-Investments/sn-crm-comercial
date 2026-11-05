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
  scope: string | null; methodology_id: string; template_id: string;
};

export type Zone = { id: string; name: string; description: string | null; position: number };

type Tramo = { probabilidad: number; efectividadControl: number; magnitud: number; nivel: Nivel };
export type Valuation = { impacto: number; inherente: { magnitud: number; nivel: Nivel }; actual: Tramo; residual: Tramo };

export type Risk = {
  id: string; number: number; zone_id: string | null; catalog_risk_code: string | null; process_code: string | null;
  title: string; causes: string | null; consequences: string | null;
  probability: number; impact_company: number; impact_people: number;
  current_control: string | null; current_quality: number | null; current_efficacy: number | null; current_efficiency: number | null;
  proposed_control: string | null; proposed_quality: number | null; proposed_efficacy: number | null; proposed_efficiency: number | null;
  origin: 'manual' | 'agente'; valuation: Valuation;
};

export type Action = {
  id: string; risk_id: string; description: string; owner_label: string | null; due_date: string | null;
  priority: 'alta' | 'media' | 'baja'; status: 'pendiente' | 'en_curso' | 'cumplida' | 'descartada';
};

export type Catalog = { procesos: Array<{ codigo: string; nombre: string }>; riesgos: Array<{ codigo: string; nombre: string; procesos: string[] }> };

export type StudyDetail = {
  study: Study; zones: Zone[]; risks: Risk[]; actions: Action[]; editable: boolean; catalog: Catalog | null;
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

export const STATUS_LABELS: Record<StudyStatus, string> = {
  borrador: 'Borrador', en_revision: 'En revisión', devuelto: 'Devuelto', revisado: 'Revisado', aprobado: 'Aprobado', archivado: 'Archivado',
};
export const NIVEL_LABELS: Record<Nivel, string> = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico' };
export const NIVEL_ORDER: Nivel[] = ['critico', 'alto', 'moderado', 'bajo'];

// Escalas de la metodología v1 (documento maestro ESU 2026, tablas de probabilidad e impacto).
export const PROBABILITY_SCALE = ['Rara', 'Baja', 'Media', 'Alta', 'Muy alta'];
export const IMPACT_SCALE = ['Menor', 'Bajo', 'Moderado', 'Alto', 'Crítico'];
// Los Excel de referencia califican el control de 1 a 5 sin nombrar cada valor; aquí tampoco se inventan nombres.
export const CONTROL_SCALE = ['1', '2', '3', '4', '5'];
