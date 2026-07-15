import type { ReactNode } from 'react';

export type TenderModuleView = 'radar' | 'seguimiento' | 'expedientes' | 'perfiles';
export type TenderRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
export type TenderSection = 'hacer' | 'revisar' | 'descartar';
export type TenderInternalStatus = 'nueva' | 'en_revision' | 'convertida_oportunidad' | 'descartada';
export type TenderDeadlineFilter = 'todas' | '0_7' | '8_15' | '16_30' | 'vencida' | 'sin_fecha';
export type TenderValueFilter = 'todas' | 'sin_valor' | 'lt_50m' | '50m_500m' | '500m_plus' | '1000m_plus';
export type TenderScoreFilter = 'todas' | 'alto' | 'medio' | 'bajo';
export type TenderSortKey = 'deadline' | 'value' | 'score' | 'entity' | 'source';
export type TenderRegionKey = 'todas' | 'bog_cundinamarca' | 'med_antioquia' | 'eje_cafetero' | 'cali_valle' | 'costa_caribe' | 'santanderes' | 'sur_occidente' | 'otros';
export type TenderTrackingStatus = 'pendiente_revision' | 'analizando' | 'esperando_informacion' | 'listo_para_decision' | 'bloqueado';

export type PublicTender = {
  id: string; stable_key?: string; source: string; section: TenderSection; internal_status?: TenderInternalStatus;
  converted_opportunity_id?: string | null; tracking_updated_at?: string | null; reviewed_at?: string | null; reviewed_by?: string | null;
  tracking_owner_id?: string | null; tracking_status?: TenderTrackingStatus | null; tracking_next_action?: string | null;
  tracking_due_at?: string | null; tracking_blocker?: string | null; tracking_last_note?: string | null; tracking_started_at?: string | null;
  detected_at?: string | null; last_seen_at?: string | null; entity: string; dept?: string; city?: string;
  ref?: string; process_id?: string; title: string; desc?: string; value: number; status?: string;
  category?: string; published?: string | null; deadline?: string | null; window?: string; days?: number | null;
  score: number; reasons: string[]; risks: string[]; url?: string;
};
export type TenderTrackingUpdate = { id: string; tracking_owner_id: string; tracking_status: TenderTrackingStatus; tracking_next_action?: string | null; tracking_due_at?: string | null; tracking_blocker?: string | null; note?: string | null; expected_tracking_updated_at: string | null };
export type TenderTrackingEvent = { id: string; tender_id: string; event_type: string; note?: string | null; from_status?: string | null; to_status?: string | null; assigned_to?: string | null; next_action?: string | null; due_at?: string | null; blocker?: string | null; created_by?: string | null; created_at: string };
export type TenderSourceDiagnostic = { source: string; status: 'ok' | 'error' | string; count?: number; message?: string };
export type TenderRadarPayload = { generatedAt: string; source?: string; diagnostics?: TenderSourceDiagnostic[]; totals: { all: number; hacer: number; revisar: number; descartar: number; highValue: number; urgent: number; enRevision?: number; convertidas?: number; descartadas?: number }; tenders: PublicTender[] };
export type TenderDocumentImportStatus = 'analisis_generado' | 'fallo_importacion' | 'no_aplica';
export type TenderConversionResult = { id: string; duplicate: boolean; document_import_status: TenderDocumentImportStatus; document_import_error: string | null };
export type TenderSearchProfile = { id: string; name: string; description?: string | null; region_key: TenderRegionKey; source_filter: string; section_filter: TenderSection | 'todas'; internal_status_filter: TenderInternalStatus | 'todas'; deadline_filter: TenderDeadlineFilter; value_filter: TenderValueFilter; score_filter: TenderScoreFilter; query_text?: string | null; is_default?: boolean; created_at?: string; updated_at?: string };
export type TenderCompanyProfile = { legal_name?: string | null; nit?: string | null; rup_status?: string | null; rup_updated_at?: string | null; rup_unspsc_codes?: string | null; authorized_services?: string | null; supervigilancia_license?: string | null; financial_capacity?: string | null; organizational_capacity?: string | null; experience_summary?: string | null; certifications?: string | null; recurring_documents?: string | null; disqualifications_notes?: string | null; useful_company_info?: string | null; source_document_name?: string | null; rup_import_notes?: string | null; updated_at?: string | null; updated_by_name?: string | null };
export type TenderDossier = { tender_id?: string; opportunity_id: string; entity?: string; title?: string; source?: string; document_count: number; missing_document_count: number; document_import_status: string; document_import_error?: string | null; go_no_go?: string | null; risk?: string | null; checklist_progress?: { total?: number; auto_generated?: number; human_required?: number } | null; preparation_status?: string | null; human_pending_count?: number; sharepoint_status?: string | null; sharepoint_url?: string | null; dossier_error?: string | null };
export type TenderModuleData = { currentProfile: { id: string; full_name: string; role: string; microsoft_email?: string | null }; profiles: Array<{ id: string; full_name: string; role: string }> };
export type TendersModuleProps = { view: TenderModuleView; data: TenderModuleData; refresh: () => Promise<void>; request: TenderRequest; navigate: (hash: string) => void; children?: ReactNode };
