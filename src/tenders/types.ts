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
export type TenderTrackingUpdate = {
  id: string; tracking_owner_id: string; tracking_status: TenderTrackingStatus; tracking_next_action?: string | null;
  tracking_due_at?: string | null; tracking_blocker?: string | null; note?: string | null; expected_tracking_updated_at: string | null;
};
export type TenderTrackingEvent = {
  id: string; tender_id: string; event_type: string; note?: string | null; from_status?: string | null; to_status?: string | null;
  assigned_to?: string | null; next_action?: string | null; due_at?: string | null; blocker?: string | null; created_by?: string | null; created_at: string;
};
export type TenderSourceDiagnostic = { source: string; status: 'ok' | 'error' | string; count?: number; message?: string };
export type TenderRadarPayload = {
  generatedAt: string; source?: string; diagnostics?: TenderSourceDiagnostic[];
  totals: { all: number; hacer: number; revisar: number; descartar: number; highValue: number; urgent: number; enRevision?: number; convertidas?: number; descartadas?: number };
  tenders: PublicTender[];
};
export type TenderConversionResult = { id: string; document_import_status?: string | null; document_import_error?: string | null };

export type TenderModuleData = {
  currentProfile: { id: string; full_name: string; role: string; microsoft_email?: string | null };
  profiles: Array<{ id: string; full_name: string; role: string }>;
};

export type TendersModuleProps = {
  view: TenderModuleView;
  data: TenderModuleData;
  refresh: () => Promise<void>;
  request: TenderRequest;
  navigate: (hash: string) => void;
  /** Transitional adapter retained only for views not yet migrated. */
  renderLegacy: () => ReactNode;
};
